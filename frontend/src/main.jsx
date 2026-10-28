import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './utils/queryClient';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import './index.css';
import App from './App.jsx';

registerServiceWorker();

const queryClient = createQueryClient();

createRoot(document.getElementById('root')).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<App />
			</BrowserRouter>
		</QueryClientProvider>
	</StrictMode>,
);
