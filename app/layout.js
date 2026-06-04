import './styles.css';

export const metadata = {
  title: 'Printer Online SP',
  description: 'Online print ordering with payment-gated printing'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
