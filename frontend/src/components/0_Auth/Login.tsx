import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/UI/card';
import { Input } from '@/UI/input';
import { Button } from '@/UI/button';
import { Label } from '@/UI/label';
import { GoogleAuthButton } from './GoogleAuthButton';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(import.meta.env.VITE_DEV_EMAIL ?? 'romeodombaj@gmail.com');
  const [password, setPassword] = useState(import.meta.env.VITE_DEV_PASSWORD ?? 'Romeodombaj1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      login(data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSuccess(accessToken: string) {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Google login failed');
      login(data.user);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{t('auth.welcomeBack')}</CardTitle>
              <CardDescription>
                {googleClientId ? t('auth.loginWithGoogleOrEmail') : t('auth.loginWithEmail')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6">
                {googleClientId && (
                  <>
                    <div className="flex flex-col gap-4">
                      <GoogleAuthButton
                        label={t('auth.loginWithGoogle')}
                        disabled={loading}
                        onSuccess={handleGoogleSuccess}
                        onError={() => setError('Google login failed')}
                      />
                    </div>
                    <div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
                      <span className="relative z-10 bg-card px-2 text-muted-foreground">{t('auth.orContinueWith')}</span>
                    </div>
                  </>
                )}
                <form onSubmit={handleSubmit} className="grid gap-6">
                  <div className="grid gap-2">
                    <Label htmlFor="email">{t('auth.email')}</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder={t('auth.emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <div className="flex items-center">
                      <Label htmlFor="password">{t('auth.password')}</Label>
                      <a href="#" className="ml-auto text-sm underline-offset-4 hover:underline">
                        {t('auth.forgotPassword')}
                      </a>
                    </div>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? t('auth.loggingIn') : t('auth.login')}
                  </Button>
                </form>
                <div className="text-center text-sm">
                  {t('auth.noAccount')}{' '}
                  <Link to="/register" className="underline underline-offset-4">
                    {t('auth.signUp')}
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
          <div className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-primary">
            By clicking continue, you agree to our <a href="#">{t('auth.termsOfService')}</a> and{' '}
            <a href="#">{t('auth.privacyPolicy')}</a>.
          </div>
        </div>
      </div>
    </div>
  );
}
