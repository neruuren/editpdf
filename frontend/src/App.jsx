import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import AppUpdateOverlay from './components/AppUpdateOverlay';
import PrivateRoute from './components/PrivateRoute';
import StatusMessage from './components/StatusMessage';

// Pages chargées à la demande : chaque page = son propre chunk (la future
// visionneuse, avec MuPDF, ne doit pas alourdir la page de connexion).
const LoginPage = lazy(() => import('./pages/LoginPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function App() {
	return (
		<>
			<Suspense fallback={<StatusMessage>Chargement…</StatusMessage>}>
				<Routes>
					<Route path="/login" element={<LoginPage />} />
					<Route element={<PrivateRoute />}>
						<Route element={<AppLayout />}>
							<Route index element={<LibraryPage />} />
						</Route>
					</Route>
					<Route path="*" element={<NotFoundPage />} />
				</Routes>
			</Suspense>
			<AppUpdateOverlay />
		</>
	);
}

export default App;
