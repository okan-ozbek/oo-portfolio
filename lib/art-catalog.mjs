export const technicalPresets = [
  {id:'terrain',name:'Contour atlas',topic:'Graphics computing',code:'GPU / HEIGHTFIELD'},
  {id:'fluid',name:'Fluid currents',topic:'Fluid simulations',code:'SIM / FLOW FIELD'},
  {id:'ragdoll',name:'Gravity playground',topic:'Physics simulations',code:'SIM / BALL PHYSICS'},
  {id:'cpu',name:'Inside the processor',topic:'Computer architecture',code:'CPU / REGISTER FILE'},
  {id:'neural',name:'Learning graph',topic:'Machine learning',code:'ML / NEURAL NETWORK'},
  {id:'orbital',name:'Orbital mechanics',topic:'Physics & mathematics',code:'PHY / ORBITAL SYSTEM'},
  {id:'reaction',name:'Reaction garden',topic:'Emergent systems',code:'SIM / REACTION FIELD'},
  {id:'particles',name:'Particle accelerator',topic:'Parallel computing',code:'GPU / PARTICLE FLOW'},
  {id:'raytrace',name:'Light laboratory',topic:'Rendering & optics',code:'GPU / RAY TRACING'},
  {id:'circuitry',name:'Signal paths',topic:'Digital logic',code:'HW / LOGIC CIRCUIT'},
];
export const projectPresets = [
  {id:'project-network',kind:'network',name:'Hardware network',topic:'Visual Hardware IDE',code:'PXW / NETWORK'},
  {id:'project-market',kind:'market',name:'Market feed',topic:'Trading systems',code:'PXW / MARKET'},
  {id:'project-binary',kind:'binary',name:'Binary field',topic:'Experimental software',code:'PXW / RESEARCH'},
  {id:'project-stack',kind:'stack',name:'Memory stack',topic:'Systems tooling',code:'PXW / TOOLS'},
  {id:'project-blackhole',kind:'blackhole',name:'Event horizon',topic:'Data visualization',code:'PXW / DATA'},
  {id:'project-latency',kind:'latency',name:'Latency traces',topic:'Performance experiments',code:'PXW / PERFORMANCE'},
];
// Keep the original choices valid in saved drafts and historical revisions.
export const legacyPresets = ['network','binary','stack','latency'];
export const presets = [...technicalPresets,...projectPresets].map(preset=>preset.id).concat(legacyPresets);
export const artDescriptor = id => [...technicalPresets,...projectPresets].find(preset=>preset.id===id) ?? projectPresets.find(preset=>preset.kind===id) ?? technicalPresets[0];
