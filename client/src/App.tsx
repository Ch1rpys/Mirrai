import { Suspense, lazy } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch, useLocation } from "wouter";
import { useRouteFocus } from "./lib/route-focus";
import { ConfirmProvider } from "./components/ConfirmDialog";
import ErrorBoundary from "./components/ErrorBoundary";
import PageLoader from "./components/PageLoader";
import { ThemeProvider, useTheme } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import HomePage from "./pages/HomePage";
import TimezoneSync from "./components/TimezoneSync";
import CommandPalette from "./components/CommandPalette";
import NotificationNavigator from "./components/v6/NotificationNavigator";
import AppLock from "./components/v6/AppLock";
import EncryptionUnlockGate from "./components/v6/EncryptionUnlockGate";

const Login = lazy(() => import("./pages/Login"));
const Settings = lazy(() => import("./pages/Settings"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Diary = lazy(() => import("./pages/Diary"));
const PersonaEdit = lazy(() => import("./pages/PersonaEdit"));
const SealManage = lazy(() => import("./pages/SealManage"));
const PersonaProfile = lazy(() => import("./pages/PersonaProfile"));
const Graduation = lazy(() => import("./pages/Graduation"));
const Upload = lazy(() => import("./pages/Upload"));
const Chat = lazy(() => import("./pages/Chat"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Questionnaire = lazy(() => import("./pages/Questionnaire"));
const Interview = lazy(() => import("./pages/Interview"));
const NotFound = lazy(() => import("./pages/NotFound"));
const BlindTest = lazy(() => import("./pages/BlindTest"));
const BlindGuest = lazy(() => import("./pages/BlindGuest"));
const Consent = lazy(() => import("./pages/Consent"));
const Inferences = lazy(() => import("./pages/Inferences"));
const Voices = lazy(() => import("./pages/Voices"));
const Records = lazy(() => import("./pages/Records"));
const Report = lazy(() => import("./pages/Report"));
const Call = lazy(() => import("./pages/Call"));
const Decode = lazy(() => import("./pages/Decode"));
const Rehearsal = lazy(() => import("./pages/Rehearsal"));
const Mirror = lazy(() => import("./pages/Mirror"));
const Roleplay = lazy(() => import("./pages/Roleplay"));
const Book = lazy(() => import("./pages/Book"));
const ShareAccept = lazy(() => import("./pages/ShareAccept"));
const Letters = lazy(() => import("./pages/Letters"));
const ShareInbox = lazy(() => import("./pages/ShareInbox"));
const ChatLast = lazy(() => import("./pages/ChatLast"));
const Group = lazy(() => import("./pages/Group"));

function Router() {
  const [location] = useLocation();
  /**
   * The focus follows the route.
   *
   * A client-side navigation replaces the page without moving the
   * focus: so a keyboard user who pressed a link is left with the focus
   * on a link that is not there any more, and a screen reader is still
   * reading the page they came from.
   */
  useRouteFocus(location);

  return (
    <>
      <NotificationNavigator />
      <Suspense fallback={<PageLoader />}>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/onboarding" component={Onboarding} />
          <Route path="/persona/new/questionnaire" component={Questionnaire} />
          <Route path="/persona/new/interview" component={Interview} />
          <Route path="/login" component={Login} />
          <Route path="/settings" component={Settings} />
          <Route path="/analytics" component={Analytics} />
          <Route path="/diary" component={Diary} />
          <Route path="/persona/:id/interview" component={Interview} />
          <Route path="/persona/:id/edit" component={PersonaEdit} />
          <Route path="/persona/:id/seal" component={SealManage} />
          <Route path="/persona/:id/profile" component={PersonaProfile} />
          <Route path="/persona/:id/blind-test" component={BlindTest} />
          <Route path="/persona/:id/voices" component={Voices} />
          <Route path="/persona/:id/records" component={Records} />
          <Route path="/persona/:id/report" component={Report} />
          <Route path="/persona/:id/call" component={Call} />
          <Route path="/persona/:id/decode" component={Decode} />
          <Route path="/persona/:id/rehearsal" component={Rehearsal} />
          <Route path="/persona/:id/mirror" component={Mirror} />
          <Route path="/persona/:id/roleplay" component={Roleplay} />
          <Route path="/persona/:id/book" component={Book} />
          <Route path="/letters" component={Letters} />
          <Route path="/group/:id" component={Group} />
          <Route path="/share-inbox" component={ShareInbox} />
          <Route path="/chat/last" component={ChatLast} />
          <Route path="/share/:token" component={ShareAccept} />
          <Route path="/blind/:token" component={BlindGuest} />
          <Route path="/consent/:token" component={Consent} />
          <Route path="/inferences" component={Inferences} />
          <Route path="/persona/:id/graduation" component={Graduation} />
          <Route path="/upload/:id" component={Upload} />
          <Route path="/chat/:id" component={Chat} />
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </>
  );
}

/**
 * Framer-motion's motion setting.
 *
 * The page transitions follow the operating system's motion setting by
 * default. Framer-motion's own default is "never" — it does not consult the
 * system at all — so a user with vestibular sensitivity got full sliding and
 * fading transitions even though they had asked the system to reduce motion.
 * The stylesheet's `prefers-reduced-motion` rules neutralised the CSS
 * animations, which made it look handled.
 *
 * The app's own switch (the accessibility panel) is on top of the system's:
 * turning it on means "always reduce", and leaving it off means "follow the
 * system".
 */
function MotionSettings({ children }: { children: React.ReactNode }) {
  const { reduceMotion } = useTheme();
  return (
    <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
      {children}
    </MotionConfig>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <LocaleProvider>
          <TooltipProvider>
            <MotionSettings>
              <Toaster />
              {/* The app lock's screen, over everything (C8.4). */}
              <AppLock />
              <EncryptionUnlockGate />
              <TimezoneSync />
              <CommandPalette />
              {/* The app's own confirmation, in the app's own language. */}
              <ConfirmProvider>
                <Router />
              </ConfirmProvider>
            </MotionSettings>
          </TooltipProvider>
        </LocaleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
