import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// React owns only the view state; the local server persists sessions and plans.
createRoot(document.getElementById('root')!).render(<App />);
