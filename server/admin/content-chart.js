import { renderActivityChart } from './activity-chart.js';
import { initFilterPicker } from './filter-picker.js';

export function initContentChart({ api, kind, prefix }) {
  const $=id=>document.getElementById(prefix+id);
  const range=$('range');let version=0;
  initFilterPicker(range,{calendar:true});
  async function refresh(){
    const current=++version;
    $('activity-chart').setAttribute('aria-busy','true');
    try{
      const data=await api(`view-activity?kind=${kind}&range=${encodeURIComponent(range.value)}`);
      if(current!==version)return;
      const series=data.series.map(item=>({...item,daily:item.daily.map(day=>({day:day.day,clicks:day.views}))}));
      renderActivityChart(series,data.chartStartDay,data.chartEndDay,{prefix,label:item=>item.title,metric:'view',entity:kind==='blog'?'posts':'projects',emptyMessage:`Publish a ${kind==='blog'?'post':'project'} to see its view activity.`});
    }catch(error){if(current===version)$('chart-message').textContent=`Could not load views. ${error.message}`;}
    finally{if(current===version)$('activity-chart').removeAttribute('aria-busy');}
  }
  range.addEventListener('change',()=>void refresh());
  return {refresh,reset(){version++;$('activity-chart').replaceChildren();$('activity-chart').removeAttribute('aria-busy');$('chart-legend').replaceChildren();$('chart-scale').replaceChildren();$('chart-tooltip').hidden=true;$('chart-message').textContent='Loading view activity…';}};
}
