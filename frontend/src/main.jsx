import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from './utils/queryClient';
import { registerServiceWorker } from './pwa/registerServiceWorker';
import './index.css';
import App from './App.jsx';

registerServiceWorker();

const queryClient = createQueryClient();
// Routeur « de données » autour des routes d'App : seul ce type de routeur
// sait retenir une navigation (useBlocker : annotations non enregistrées).
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
