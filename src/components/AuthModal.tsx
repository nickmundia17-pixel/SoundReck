import { useState, useRef } from 'react';
import { X, Mail, Phone, ShieldCheck, UserCheck, Disc3 } from 'lucide-react';
import {
  type ConfirmationResult,
  type User,
} from 'firebase/auth';
import {
  signInWithGooglePopup,
  registerWithEmail,
  loginWithEmail,
  createPhoneRecaptcha,
  startPhoneSignIn,
  upsertCreatorProfile,
  upsertPrivateInfo,
  logoutUser,
  type CreatorProfile,
  type CreatorRole,
} from '../firebase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  profile: CreatorProfile | null;
  onProfileSaved: () => void;
}

type AuthTab = 'google' | 'phone' | 'email';

export function AuthModal({
  isOpen,
  onClose,
  user,
  profile,
  onProfileSaved,
}: AuthModalProps) {
  const [authTab, setAuthTab] = useState<AuthTab>('google');
  const [role, setRole] = useState<CreatorRole>(profile?.role || 'artist');
  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [buyMeSodaHandle, setBuyMeSodaHandle] = useState(profile?.buyMeSodaHandle || '');
  const [bio, setBio] = useState(profile?.bio || '');

  // Email auth state
  const [emailMode, setEmailMode] = useState<'register' | 'signin'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Phone auth state
  const [phoneNumber, setPhoneNumber] = useState('+1');
  const [otpCode, setOtpCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const formatAuthError = (err: unknown): string => {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.includes('auth/operation-not-allowed')) {
      return 'This sign-in provider is not enabled yet in your Firebase Console (Authentication > Sign-in method). Google Sign-In is enabled by default.';
    }
    if (raw.includes('auth/unauthorized-domain')) {
      return 'This preview domain needs to be added to Firebase Console > Authentication > Settings > Authorized domains.';
    }
    if (raw.includes('auth/popup-closed-by-user')) {
      return 'Sign-in popup was closed before completing authentication.';
    }
    if (raw.includes('auth/invalid-phone-number')) {
      return 'Please enter a valid international phone number including country code (e.g. +14155550199).';
    }
    return raw;
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const signedInUser = await signInWithGooglePopup();
      const nameToUse = displayName.trim() || signedInUser.displayName || 'Studio Creator';
      await upsertCreatorProfile(signedInUser.uid, {
        displayName: nameToUse,
        role,
        buyMeSodaHandle,
        bio,
      });
      await upsertPrivateInfo(signedInUser.uid, {
        email: signedInUser.email || '',
      });
      onProfileSaved();
      setStatusMsg('Signed in with Google and studio profile synced.');
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSendPhoneOtp = async () => {
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const verifier = createPhoneRecaptcha('recaptcha-container-node');
      const result = await startPhoneSignIn(phoneNumber.trim(), verifier);
      setConfirmation(result);
      setStatusMsg('Verification SMS code sent. Enter the 6-digit code below.');
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPhoneOtp = async () => {
    if (!confirmation) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const cred = await confirmation.confirm(otpCode.trim());
      const nameToUse = displayName.trim() || 'Phone Creator';
      await upsertCreatorProfile(cred.user.uid, {
        displayName: nameToUse,
        role,
        buyMeSodaHandle,
        bio,
      });
      await upsertPrivateInfo(cred.user.uid, {
        phone: cred.user.phoneNumber || phoneNumber.trim(),
      });
      onProfileSaved();
      setStatusMsg('Phone verified and creator account activated.');
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      if (emailMode === 'register') {
        const newUser = await registerWithEmail(email.trim(), password, displayName.trim() || 'Studio Creator');
        setStatusMsg(
          `Account created for ${newUser.email}. Please check your inbox and click the verification link before saving cloud projects.`
        );
      } else {
        const existingUser = await loginWithEmail(email.trim(), password);
        if (existingUser.emailVerified) {
          await upsertCreatorProfile(existingUser.uid, {
            displayName: displayName.trim() || existingUser.displayName || 'Studio Creator',
            role,
            buyMeSodaHandle,
            bio,
          });
          onProfileSaved();
          setStatusMsg('Signed in and profile synced.');
        } else {
          setStatusMsg('Signed in. Verify your email address to unlock cloud saves.');
        }
      }
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      await upsertCreatorProfile(user.uid, {
        displayName: displayName.trim() || user.displayName || 'Studio Creator',
        role,
        buyMeSodaHandle,
        bio,
      });
      onProfileSaved();
      setStatusMsg('Creator profile & BuymeSoda handle updated.');
    } catch (err) {
      setErrorMsg(formatAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await logoutUser();
      setStatusMsg(null);
      setConfirmation(null);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Studio Account Registration"
    >
      <div className="w-full max-w-lg rounded-xl bg-[#13161B] border border-[#232833] shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#232833]">
          <div className="flex items-center gap-2.5">
            <Disc3 className="w-5 h-5 text-amber-400" />
            <h2 className="font-display text-lg font-semibold text-slate-100">
              {user ? 'Creator Studio Profile' : 'Register or Sign In'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-[#1B2028] transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-800/60 text-xs text-red-200 leading-relaxed">
              {errorMsg}
            </div>
          )}
          {statusMsg && (
            <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-800/60 text-xs text-emerald-200 leading-relaxed">
              {statusMsg}
            </div>
          )}

          {/* Role & Studio Identity */}
          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-400">
              Select your primary studio role
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'artist', label: 'Artist' },
                  { id: 'creator', label: 'Content Creator' },
                  { id: 'dj', label: 'Pro DJ' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRole(item.id)}
                  className={`py-2.5 px-3 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    role === item.id
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                      : 'bg-[#0B0D10] border-[#232833] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Stage / Creator Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="e.g. DJ Kairo"
                  maxLength={80}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">BuymeSoda Handle</label>
                <input
                  type="text"
                  value={buyMeSodaHandle}
                  onChange={(e) => setBuyMeSodaHandle(e.target.value)}
                  placeholder="e.g. djkairo"
                  maxLength={80}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>
          </div>

          {user ? (
            <form onSubmit={handleUpdateProfile} className="space-y-4 pt-2 border-t border-[#232833]">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Creator Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={2}
                  maxLength={300}
                  placeholder="Afrobeats producer, DJ, and short-form music creator..."
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-amber-400" />
                  <span>{user.email || user.phoneNumber || 'Authenticated Creator'}</span>
                </div>
                <span className="font-mono">
                  {user.emailVerified || user.phoneNumber ? 'Verified' : 'Unverified Email'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {loading ? 'Saving...' : 'Save Studio Profile'}
                </button>
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={loading}
                  className="py-2.5 px-4 rounded-lg bg-[#1B2028] hover:bg-[#252B36] text-slate-200 text-sm font-medium border border-[#2A313E] transition-colors whitespace-nowrap"
                >
                  Sign Out
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4 pt-2 border-t border-[#232833]">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#0B0D10] border border-[#232833]">
                <button
                  type="button"
                  onClick={() => setAuthTab('google')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    authTab === 'google'
                      ? 'bg-[#1B2028] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Google Account
                </button>
                <button
                  type="button"
                  onClick={() => setAuthTab('phone')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    authTab === 'phone'
                      ? 'bg-[#1B2028] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Phone SMS
                </button>
                <button
                  type="button"
                  onClick={() => setAuthTab('email')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    authTab === 'email'
                      ? 'bg-[#1B2028] text-amber-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Email & Password
                </button>
              </div>

              {authTab === 'google' && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Instant verified creator registration via Google OAuth popup. Syncs your music projects, lyrics, and BuymeSoda handle.
                  </p>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={loading}
                    className="w-full py-3 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{loading ? 'Connecting Google...' : 'Continue with Google'}</span>
                  </button>
                </div>
              )}

              {authTab === 'phone' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Mobile Number (E.164 format, e.g. +14155550199)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+1 555 010 9988"
                        className="flex-1 px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={handleSendPhoneOtp}
                        disabled={loading}
                        className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                      >
                        <Phone className="w-3.5 h-3.5" />
                        <span>Send Code</span>
                      </button>
                    </div>
                  </div>

                  {confirmation && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        placeholder="6-digit SMS code"
                        maxLength={8}
                        className="flex-1 px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={handleVerifyPhoneOtp}
                        disabled={loading}
                        className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                      >
                        Verify SMS
                      </button>
                    </div>
                  )}
                  <div id="recaptcha-container-node" ref={recaptchaContainerRef} />
                </div>
              )}

              {authTab === 'email' && (
                <form onSubmit={handleEmailAuth} className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">
                      {emailMode === 'register' ? 'Create new studio account' : 'Sign in with existing email'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEmailMode(emailMode === 'register' ? 'signin' : 'register')}
                      className="text-amber-400 hover:underline"
                    >
                      {emailMode === 'register' ? 'Switch to Sign In' : 'Switch to Register'}
                    </button>
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="artist@studio.com"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password (6+ characters)"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0D10] border border-[#232833] text-sm text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Mail className="w-4 h-4" />
                    <span>
                      {loading
                        ? 'Processing...'
                        : emailMode === 'register'
                        ? 'Create Studio Account'
                        : 'Sign In with Email'}
                    </span>
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
