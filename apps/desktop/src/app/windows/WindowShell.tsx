import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ConnectionProvider } from '../../contexts/ConnectionContext';
import { ThemeProvider } from '../../contexts/ThemeContext';

export interface StandaloneConnectionProps {
  standaloneServerUrl?: string;
  standaloneServerId?: string;
  standaloneGatewayUrl?: string;
  standaloneGatewaySecret?: string;
}

export const LazyFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
  </div>
);

interface WindowShellProps {
  children: ReactNode;
  label?: string;
  withTheme?: boolean;
  connection?: true | StandaloneConnectionProps;
}

export function WindowShell({
  children,
  label,
  withTheme = true,
  connection,
}: WindowShellProps) {
  let content = <Suspense fallback={<LazyFallback />}>{children}</Suspense>;

  if (connection) {
    const connectionProps = connection === true ? {} : connection;
    content = (
      <ConnectionProvider {...connectionProps}>
        {content}
      </ConnectionProvider>
    );
  }

  if (label) {
    content = <ErrorBoundary label={label}>{content}</ErrorBoundary>;
  }

  if (withTheme) {
    content = <ThemeProvider defaultTheme="dark-neutral">{content}</ThemeProvider>;
  }

  return content;
}
