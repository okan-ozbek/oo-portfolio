import mermaid from 'mermaid';
// Resolve the same CSS tokens used by syntax highlighting and both block containers.
const styles=getComputedStyle(document.documentElement);
const token=name=>styles.getPropertyValue(name).trim();
const surface=token('--content-surface'),raised=token('--content-raised'),border=token('--content-border'),text=token('--content-text'),muted=token('--content-muted'),accent=token('--content-accent'),mono=token('--site-mono');
mermaid.initialize({
  startOnLoad:false,theme:'base',look:'classic',securityLevel:'strict',fontFamily:mono,
  sequence:{actorFontFamily:mono,noteFontFamily:mono,messageFontFamily:mono,actorFontSize:parseInt(token('--content-font-size'),10),noteFontSize:parseInt(token('--content-font-size'),10),messageFontSize:parseInt(token('--content-font-size'),10)},
  themeVariables:{
    darkMode:true,fontFamily:mono,fontSize:token('--content-font-size'),background:surface,
    primaryColor:raised,secondaryColor:surface,tertiaryColor:raised,
    primaryTextColor:text,secondaryTextColor:text,tertiaryTextColor:text,
    primaryBorderColor:accent,secondaryBorderColor:border,tertiaryBorderColor:border,
    lineColor:muted,arrowheadColor:muted,textColor:text,titleColor:text,
    mainBkg:raised,nodeBkg:raised,nodeBorder:accent,nodeTextColor:text,
    clusterBkg:surface,clusterBorder:border,defaultLinkColor:muted,edgeLabelBackground:surface,
    actorBkg:raised,actorBorder:accent,actorTextColor:text,actorLineColor:muted,
    signalColor:muted,signalTextColor:text,labelBoxBkgColor:raised,labelBoxBorderColor:border,
    labelTextColor:text,loopTextColor:text,sequenceNumberColor:surface,
    noteBkgColor:raised,noteTextColor:text,noteBorderColor:accent,
    activationBkgColor:raised,activationBorderColor:accent,
    classText:text,fillType0:raised,fillType1:surface,
    stateBkg:raised,stateLabelColor:text,labelBackgroundColor:surface,
    compositeBackground:surface,compositeTitleBackground:raised,compositeBorder:border,
    altBackground:raised,transitionColor:muted,transitionLabelColor:text,
    specialStateColor:accent,innerEndBackground:accent,
  },
  maxTextSize:50000,maxEdges:500,suppressErrorRendering:true,
  secure:['secure','securityLevel','startOnLoad','maxTextSize','maxEdges','theme','look','themeVariables','themeCSS','fontFamily','flowchart','sequence','dompurifyConfig'],
});
let counter=0;
export async function renderDiagrams(root) {
  // Measure labels with the actual site font, including on a fresh page load.
  await document.fonts.ready;
  for(const node of root.querySelectorAll('[data-mermaid]:not([data-rendered])')) {
    node.dataset.rendered='true';const body=node.querySelector('.blog-diagram-body'),source=body.querySelector('pre')?.textContent??'';node.dataset.source=source;
    try{const {svg}=await mermaid.render(`blog-mermaid-${++counter}`,source);if(!node.isConnected)continue;body.innerHTML=svg;body.setAttribute('role','img');body.setAttribute('aria-label','Mermaid diagram');}
    catch(error){const message=document.createElement('p');message.className='blog-diagram-error';message.textContent=`Diagram could not be rendered: ${String(error.message??error).slice(0,350)}`;body.append(message);}
  }
}
