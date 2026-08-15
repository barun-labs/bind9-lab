import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { StoreProvider } from './data/store';

export default function App() {
  return (
    <StoreProvider>
      <RouterProvider router={router} />
    </StoreProvider>
  );
}
