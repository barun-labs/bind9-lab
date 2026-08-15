import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { StoreProvider } from './data/store';
import { AuthProvider } from './auth/AuthProvider';

export default function App() {
  return (
    <StoreProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </StoreProvider>
  );
}
