// One transaction, always rolled back. No OpenAI calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { createRecord } from '../repositories/entities.js';
import { messagesIn,modelHistory,ownConversation } from '../services/chat-history.js';
import { compileSearch } from '../services/search.js';
import ExcelJS from 'exceljs';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

const db=await pool.connect();
try{
  const actor=(await db.query('SELECT "objectId" FROM portal.users WHERE lower(email)=lower($1) AND active=true AND "archivedAt" IS NULL',[process.env.ADMIN_EMAIL])).rows[0]?.objectId;
  assert(actor,'Configured admin required');
  await db.query('BEGIN');
  await db.query("SELECT set_config('portal.actor_id',$1,true),set_config('portal.allow_archive','on',true)",[actor]);
  const conversation=await createRecord(db,'chat_conversations',{owner_id:actor,title:'Rollback smoke',model:'gpt-5-mini',reasoning_effort:'medium'});
  await assert.rejects(()=>ownConversation(db,randomUUID(),conversation.objectId),/Konversation nicht gefunden/);
  for(let i=0;i<14;i++)await createRecord(db,'chat_messages',{conversation_id:conversation.objectId,role:i%2?'assistant':'user',content:'Message '+i,sent_at:new Date(Date.now()-20000+i*1000).toISOString(),reply_to_id:null,response_time_ms:null,model:'gpt-5-mini',reasoning_effort:'medium',status:'complete',metadata:{}});
  const question=await createRecord(db,'chat_messages',{conversation_id:conversation.objectId,role:'user',content:'Attached document',sent_at:new Date(Date.now()-1000).toISOString(),reply_to_id:null,response_time_ms:null,model:'gpt-5-mini',reasoning_effort:'medium',status:'complete',metadata:{}});
  const file=await createRecord(db,'chat_documents',{owner_id:actor,conversation_id:conversation.objectId,name:'smoke.txt',document_at:new Date().toISOString(),url:'/api/ai/documents/smoke/content',extension:'.txt',mime_type:'text/plain',size_bytes:5,source:'upload',sha256:'test',data_base64:Buffer.from('Hello').toString('base64'),extracted_text:'Hello',extraction_note:null});
  await createRecord(db,'chat_message_files',{message_id:question.objectId,document_id:file.objectId});
  const timing=(await db.query('SELECT clock_timestamp() AS sent_at,floor(extract(epoch FROM(clock_timestamp()-$1::timestamptz))*1000)::bigint AS elapsed',[question.sent_at])).rows[0];
  await createRecord(db,'chat_messages',{conversation_id:conversation.objectId,role:'assistant',content:'Reply',sent_at:timing.sent_at,reply_to_id:question.objectId,response_time_ms:timing.elapsed,model:'gpt-5-mini',reasoning_effort:'medium',status:'complete',metadata:{}});
  const messages=await messagesIn(db,conversation.objectId);
  assert.equal(messages.length,16);
  assert.equal(modelHistory(messages).length,16);
  assert.equal(messages.at(-2)!.files[0].objectId,file.objectId);
  assert.equal(messages.at(-1)!.reply_to_id,question.objectId);
  assert(messages.at(-1)!.response_time_ms>=1000);
  assert.throws(()=>compileSearch({entity:'chat_messages',fields:[{alias:'root',field:'content'}]}, {chat_messages:{can_read:true}}),/Leseberechtigung/);
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  console.log('PASS: 16-message full history, question/reply IDs, response timing, attachment references and owner access');
  const workbook=new ExcelJS.Workbook();workbook.addWorksheet('Test').addRow(['A',42]);
  const bytes=await workbook.xlsx.writeBuffer(),read=new ExcelJS.Workbook();await read.xlsx.load(bytes);
  assert.equal(read.worksheets[0].getRow(1).getCell(2).value,42);
  assert.equal(typeof PDFParse,'function');assert.equal(typeof mammoth.extractRawText,'function');
  console.log('PASS: document parser imports and XLSX read/write');
}finally{await db.query('ROLLBACK');db.release();await pool.end();console.log('ROLLBACK: no test conversations retained');}
