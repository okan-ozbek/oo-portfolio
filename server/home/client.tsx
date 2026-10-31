import { hydrateRoot } from 'react-dom/client';
import { Showcase } from '../../app/showcase';
const data=JSON.parse(document.getElementById('home-data')!.textContent!);
hydrateRoot(document.getElementById('homepage-root')!,<Showcase initialData={data}/>);

document.documentElement.classList.add('js-enabled');
