import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useEffect } from "react";
import AuthPage from "@/pages/auth";
import DashboardPage from "@/pages/dashboard";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import CharactersPage from "@/pages/characters";
import CreatePage from "@/pages/create";
import VideoDetailPage from "@/pages/video-detail";
import PricingPage from "@/pages/pricing";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const Spinner = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
  </div>
);

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Page not found.
    </div>
  );
}

function AuthRoute() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!isLoading && user) setLocation("/dashboard");
  }, [user, isLoading]);
  if (isLoading) return <Spinner />;
  if (user) return null;
  return <AuthPage />;
}

function ProtectedRoute({ component: Component, ...props }: { component: React.ComponentType<any>; [key: string]: any }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!isLoading && !user) setLocation("/");
  }, [user, isLoading]);
  if (isLoading) return <Spinner />;
  if (!user) return null;
  return <Component {...props} />;
}

function ProjectDetailRoute({ params }: { params: { id: string } }) {
  return <ProtectedRoute component={ProjectDetailPage} id={Number(params.id)} />;
}

function VideoDetailRoute({ params }: { params: { id: string } }) {
  return <ProtectedRoute component={VideoDetailPage} id={Number(params.id)} />;
}

function DashboardRoute() { return <ProtectedRoute component={DashboardPage} />; }
function CreateRoute() { return <ProtectedRoute component={CreatePage} />; }
function ProjectsRoute() { return <ProtectedRoute component={ProjectsPage} />; }
function CharactersRoute() { return <ProtectedRoute component={CharactersPage} />; }
function PricingRoute() { return <ProtectedRoute component={PricingPage} />; }

function Router() {
  return (
    <Switch>
      <Route path="/" component={AuthRoute} />
      <Route path="/dashboard" component={DashboardRoute} />
      <Route path="/create" component={CreateRoute} />
      <Route path="/projects" component={ProjectsRoute} />
      <Route path="/projects/:id" component={ProjectDetailRoute} />
      <Route path="/characters" component={CharactersRoute} />
      <Route path="/videos/:id" component={VideoDetailRoute} />
      <Route path="/pricing" component={PricingRoute} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
