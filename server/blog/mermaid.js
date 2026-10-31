import mermaid from 'mermaid';
mermaid.initialize({startOnLoad:false,theme:'base',look:'classic',securityLevel:'strict',fontFamily:'Consolas, monospace',themeVariables:{darkMode:true,background:'#111113',primaryColor:'#222227',primaryTextColor:'#e6e6eb',primaryBorderColor:'#ff3939',secondaryColor:'#2a2024',secondaryTextColor:'#e6e6eb',secondaryBorderColor:'#6b4249',tertiaryColor:'#19191c',tertiaryTextColor:'#c8c8d2',tertiaryBorderColor:'#3f3f48',lineColor:'#a3a3b2',textColor:'#e6e6eb',mainBkg:'#222227',nodeBorder:'#ff3939',clusterBkg:'#19191c',clusterBorder:'#43434d',edgeLabelBackground:'#161619',nodeTextColor:'#e6e6eb',actorBkg:'#222227',actorBorder:'#ff3939',actorTextColor:'#e6e6eb',actorLineColor:'#72727f',signalColor:'#b1b1c0',signalTextColor:'#d7d7e0',noteBkgColor:'#302326',noteTextColor:'#e6c7cc',noteBorderColor:'#a75763',activationBkgColor:'#443037',activationBorderColor:'#ff5e6c',fontSize:'13px'},maxTextSize:50000,maxEdges:500,suppressErrorRendering:true,secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','theme','look','themeVariables','themeCSS','fontFamily','flowchart','dompurifyConfig']});
let counter=0;
export async function renderDiagrams(root) {
  for(const node of root.querySelectorAll('[data-mermaid]:not([data-rendered])')) {
    node.dataset.rendered='true';const source=node.querySelector('pre')?.textContent??'';
    try{const {svg}=await mermaid.render(`blog-mermaid-${++counter}`,source);if(!node.isConnected)continue;node.innerHTML=svg;node.setAttribute('role','img');node.setAttribute('aria-label','Mermaid diagram');}
    catch(error){const message=document.createElement('p');message.className='blog-diagram-error';message.textContent=`Diagram could not be rendered: ${String(error.message??error).slice(0,350)}`;node.append(message);}
  }
}
