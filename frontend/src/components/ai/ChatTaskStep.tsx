import { Check, Circle, CircleAlert, LoaderCircle, ShieldCheck } from 'lucide-react';
import type { ChatProgress } from '../../types/ai';

export default function ChatTaskStep({
  task,
  events,
  running,
}: {
  task: { id: string; title: string; criteria: string[] };
  events: ChatProgress[];
  running: boolean;
}) {
  const stateEvent = [...events]
    .reverse()
    .find((event) => ['task', 'review', 'retry'].includes(event.stage));
  let state = stateEvent?.status || 'pending';
  if (!running && ['running', 'checking'].includes(state)) state = 'blocked';
  const latest = events.at(-1);
  const issue =
    state === 'accepted' ? undefined : [...events].reverse().find((event) => event.reason);
  return (
    <li className={'ai-task-row ' + state}>
      {state === 'accepted' ? (
        <Check size={15} />
      ) : state === 'checking' ? (
        <ShieldCheck size={15} className="ai-task-spinner" />
      ) : state === 'running' ? (
        <LoaderCircle size={15} className="ai-task-spinner" />
      ) : state === 'blocked' || state === 'failed' ? (
        <CircleAlert size={15} />
      ) : (
        <Circle size={15} />
      )}
      <div>
        <strong>{task.title}</strong>
        {latest && <p>{latest.summary}</p>}
        {issue?.reason && (
          <div className="ai-task-reason">
            <span>Konkreter Prüfpunkt</span>
            <p>{issue.reason}</p>
          </div>
        )}
        <details className="ai-task-notes">
          <summary>Ergebnis, Prüfung und Quellenarbeit</summary>
          <div className="ai-task-criteria">
            <span>Abschlusskriterien</span>
            <ul>
              {task.criteria.map((criterion, index) => (
                <li key={index}>{criterion}</li>
              ))}
            </ul>
          </div>
          <ol className="ai-task-events">
            {events.map((event, index) => (
              <li key={index}>
                <time>
                  {Math.floor(event.elapsed_ms / 60000)}:
                  {String(Math.floor(event.elapsed_ms / 1000) % 60).padStart(2, '0')}
                </time>
                <div>
                  <p>{event.summary}</p>
                  {event.reason && <p>{event.reason}</p>}
                  {!!event.details?.length && (
                    <ul>
                      {event.details.map((item, itemIndex) => (
                        <li key={itemIndex}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </li>
  );
}
