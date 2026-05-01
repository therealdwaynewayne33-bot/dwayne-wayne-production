import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import AuthPage from "@/pages/auth";
import DashboardPage from "@/pages/dashboard";
import ProjectsPage from "@/pages/projects";
import ProjectDetailPage from "@/pages/project-detail";
import CharactersPage from "@/pages/characters";
import CreatePage from "@/pages/create";
import VideoDetailPage from "@/pages/video-detail";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center text-muted-foreground">
      Page not found.
    </div>
  );
}

function ProtectedRoute({ component: Component, ...props }: { component: React.ComponentType<any>; [key: string]: any }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    setLocation("/");
    return null;
  }

  return <Component {...props} />;
}

function Router() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/" component={() => {
        if (user) { setLocation("/dashboard"); return null; }
        return <AuthPage />;
      }} />
      <Route path="/dashboard" component={() => <ProtectedRoute component={DashboardPage} />} />
      <Route path="/create" component={() => <ProtectedRoute component={CreatePage} />} />
      <Route path="/projects" component={() => <ProtectedRoute component={ProjectsPage} />} />
      <Route path="/projects/:id" component={({ params }) => <ProtectedRoute component={ProjectDetailPage} id={Number(params.id)} />} />
      <Route path="/characters" component={() => <ProtectedRoute component={CharactersPage} />} />
      <Route path="/videos/:id" component={({ params }) => <ProtectedRoute component={VideoDetailPage} id={Number(params.id)} />} />
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
