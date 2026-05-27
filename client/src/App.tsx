import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Platform from "./pages/Platform";
import ForInvestors from "./pages/ForInvestors";
import HowItWorks from "./pages/HowItWorks";
import ImplementationTiers from "./pages/ImplementationTiers";
import ExperienceTheSystem from "./pages/ExperienceTheSystem";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/platform"} component={Platform} />
      <Route path={"/for-investors"} component={ForInvestors} />
      <Route path={"/how-it-works"} component={HowItWorks} />
      <Route path={"/implementation-tiers"} component={ImplementationTiers} />
      <Route path={"/experience-the-system"} component={ExperienceTheSystem} />
      <Route path={"/about"} component={About} />
      <Route path={"/contact"} component={Contact} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/terms"} component={Terms} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="dark"
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
