import { renderToString } from 'react-dom/server';
import { Showcase, type HomeData } from '../../app/showcase';
export function renderHome(data:HomeData){return renderToString(<Showcase initialData={data}/>);}
