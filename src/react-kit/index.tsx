import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

export const render = (element: HTMLElement) => {
  const root = ReactDOM.createRoot(element);

  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  return root;
};
