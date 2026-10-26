param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $InputFile))
function Read-XmlEntry([string]$name) {
 $entry = $archive.GetEntry($name)
 if (-not $entry) { return $null }
 $reader = [IO.StreamReader]::new($entry.Open())
 try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
try {
 $stringsXml = Read-XmlEntry 'xl/sharedStrings.xml'
 $strings = [Collections.Generic.List[string]]::new()
 if ($stringsXml) { foreach ($si in $stringsXml.SelectNodes('//*[local-name()="si"]')) { $strings.Add(($si.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '') } }
 $workbook = Read-XmlEntry 'xl/workbook.xml'
 $relationships = Read-XmlEntry 'xl/_rels/workbook.xml.rels'
 $sheets = [Collections.Generic.List[object]]::new()
 foreach ($sheet in $workbook.SelectNodes('//*[local-name()="sheet"]')) {
  $rid = $sheet.GetAttribute('id','http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $relation = $relationships.SelectNodes('//*[local-name()="Relationship"]') | Where-Object { $_.Id -eq $rid }
  $target = $relation.Target
  if ($target.StartsWith('/')) { $target=$target.TrimStart('/') } else { $target='xl/'+$target }
  $sheetXml = Read-XmlEntry $target
  $rows = [Collections.Generic.List[object]]::new()
  $headers = @{}
  foreach ($row in $sheetXml.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]')) {
   $record=[ordered]@{__row=[int]$row.r}
   foreach ($cell in $row.SelectNodes('./*[local-name()="c"]')) {
    $column = $cell.r -replace '\d',''
    $node = $cell.SelectSingleNode('./*[local-name()="v"]')
    $formula = $cell.SelectSingleNode('./*[local-name()="f"]')
    if ($formula) { throw "Formula cell $($cell.r): review required before data import." }
    $value = if ($node) { $node.InnerText } else { $null }
    if ($cell.t -eq 's' -and $null -ne $value) { $value=$strings[[int]$value] }
    elseif ($cell.t -eq 'inlineStr') { $value=($cell.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' }
    elseif ($cell.t -eq 'e') { throw "Excel error in $($cell.r): $value" }
    if ($row.r -eq '1') { if ($value) { $headers[$column]=$value } }
    elseif ($headers.ContainsKey($column)) { $record[$headers[$column]]=$value }
   }
   if ($row.r -ne '1' -and $record.Count -gt 1) { $rows.Add([pscustomobject]$record) }
  }
  $sheets.Add([pscustomobject]@{name=$sheet.name;headers=@($headers.Values);rows=$rows.ToArray()})
 }
 $output=[pscustomobject]@{source=(Split-Path -Leaf $InputFile);sheets=$sheets.ToArray()}
 [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile),($output | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
 foreach ($sheet in $sheets) { Write-Output "$($sheet.name): $($sheet.rows.Count) rows; $($sheet.headers -join ', ')"; $sheet.rows | Select-Object -First 2 | ConvertTo-Json -Depth 5 }
} finally { $archive.Dispose() }
