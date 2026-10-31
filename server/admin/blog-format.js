// Return a selection-aware edit for the Markdown textarea.
export function formatMarkdown(source, start, end, kind) {
  const inline = {bold:['**','**','Bold text'],italic:['*','*','Italic text'],strike:['~~','~~','Strikethrough text'],underline:['++','++','Underlined text']};
  if (inline[kind]) {
    const [before,after,fallback]=inline[kind],selected=source.slice(start,end)||fallback;
    return {start,end,text:before+selected+after,selectionStart:start+before.length,selectionEnd:start+before.length+selected.length};
  }
  const prefixes={h1:'# ',heading:'## ',h3:'### ',subtext:'-# ',bullet:'- ',ordered:'1. ',todo:'- [ ] ',quote:'> '};
  if (!prefixes[kind]) return null;
  const lineStart=start===0?0:source.lastIndexOf('\n',start-1)+1;
  const boundary=end>start&&source[end-1]==='\n'?end-1:end;
  const nextLine=source.indexOf('\n',boundary),lineEnd=nextLine<0?source.length:nextLine;
  const selected=source.slice(lineStart,lineEnd)||'Your text';
  const lines=selected.split('\n');
  const pattern=kind==='ordered'?/^\d+\. /:kind==='todo'?/^- \[[ xX]\] /:null;
  const matches=line=>pattern?pattern.test(line):line.startsWith(prefixes[kind]);
  const remove=lines.filter(line=>line.trim()).every(matches);
  let number=0;
  const text=lines.map(line=>{
    if(!line.trim())return line;
    if(remove)return pattern?line.replace(pattern,''):line.slice(prefixes[kind].length);
    number++;
    // Replacing a line style keeps headings and lists from accumulating prefixes.
    const content=line.replace(/^(?:#{1,6} |-[#] |(?:[-*+] |\d+\. )(?:\[[ xX]\] )?|> )/,'');
    return (kind==='ordered'?`${number}. `:prefixes[kind])+content;
  }).join('\n');
  return {start:lineStart,end:lineEnd,text,selectionStart:lineStart,selectionEnd:lineStart+text.length};
}
