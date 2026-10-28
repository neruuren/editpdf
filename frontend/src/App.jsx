import { useEffect, useState } from 'react';
import './App.css';

function App() {
	const [message, setMessage] = useState('');
	const [error, setError] = useState(null);

	useEffect(() => {
		fetch('/api/message')
			.then((response) => {
				if (!response.ok) {
					throw new Error(`Request failed with status ${response.status}`);
				}
				return response.json();
			})
			.then((data) => setMessage(data.text))
			.catch((err) => {
				console.error('Error fetching message:', err);
				setError('Unable to load the message from the backend.');
			});
	}, []);

	return (
		<div>
			<h1>Message from Backend</h1>
			{error ? <p role="alert">{error}</p> : <p>{message}</p>}
		</div>
	);
}

export default App;
