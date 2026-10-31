import mermaid from 'mermaid';
mermaid.initialize({startOnLoad:false,theme:'dark',securityLevel:'strict',fontFamily:'Segoe UI, Arial, sans-serif',maxTextSize:50000,maxEdges:500,suppressErrorRendering:true,secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','theme','themeVariables','themeCSS','fontFamily','flowchart','dompurifyConfig']});
let counter=0;
export async function renderDiagrams(root) {
  for(const node of root.querySelectorAll('[data-mermaid]:not([data-rendered])')) {
    node.dataset.rendered='true';const source=node.querySelector('pre')?.textContent??'';
    try{const {svg}=await mermaid.render(`blog-mermaid-${++counter}`,source);if(!node.isConnected)continue;node.innerHTML=svg;node.setAttribute('role','img');node.setAttribute('aria-label','Mermaid diagram');}
    catch(error){const message=document.createElement('p');message.className='blog-diagram-error';message.textContent=`Diagram could not be rendered: ${String(error.message??error).slice(0,350)}`;node.append(message);}
  }
}
