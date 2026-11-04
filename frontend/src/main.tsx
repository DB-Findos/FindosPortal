import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiProvider } from './contexts/ApiContext';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ViewContentProvider } from './contexts/ViewContentContext';
import App from './app/App';
import './styles/global.css';
import './components/data/FieldSelector.css';
import './styles/theme.css';
import './styles/layout.css';
import './styles/portfolio.css';
import './styles/search.css';
import './styles/ai-chat.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ViewContentProvider>
        <ApiProvider>
          <AuthProvider>
            <ThemeProvider>
              <App />
            </ThemeProvider>
          </AuthProvider>
        </ApiProvider>
      </ViewContentProvider>
    </BrowserRouter>
  </React.StrictMode>
);
