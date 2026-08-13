import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/UI/button';
import { Input } from '@/UI/input';
import { Label } from '@/UI/label';
import { Separator } from '@/UI/separator';
import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@/UI/card';
import { GoogleAuthButton } from '@/components/0_Auth/GoogleAuthButton';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

function splitName(full: string) {
    const idx = full.indexOf(' ');
    if (idx === -1) return { firstName: full, lastName: '' };
    return { firstName: full.slice(0, idx), lastName: full.slice(idx + 1) };
}

function SectionFeedback({ error, success }: { error: string; success: string }) {
    if (!error && !success) return null;
    return (
        <p className={`text-sm ${error ? 'text-destructive' : 'text-green-600'}`}>
            {error || success}
        </p>
    );
}

function ProfileCard() {
    const { t } = useTranslation();
    const { user, refetch } = useAuth();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        if (user?.name) {
            const { firstName: f, lastName: l } = splitName(user.name);
            setFirstName(f);
            setLastName(l);
        }
    }, [user?.name]);

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setSuccess('');
        const name = `${firstName.trim()} ${lastName.trim()}`.trim();
        if (!name) { setError(t('account.nameRequired')); return; }
        setSaving(true);
        try {
            const res = await fetch('/auth/me', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update profile');
            setSuccess(t('account.profileUpdated'));
            await refetch();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t('account.profile')}</CardTitle>
                <CardDescription>{t('account.profileDescription')}</CardDescription>
            </CardHeader>
            <form onSubmit={handleSave}>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="firstName">{t('account.firstName')}</Label>
                            <Input
                                id="firstName"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder={t('account.firstName')}
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="lastName">{t('account.lastName')}</Label>
                            <Input
                                id="lastName"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder={t('account.lastName')}
                            />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label>{t('account.email')}</Label>
                        <Input value={user?.email ?? ''} disabled />
                    </div>
                    <SectionFeedback error={error} success={success} />
                </CardContent>
                <CardFooter>
                    <Button type="submit" disabled={saving}>
                        {saving ? t('common.saving') : t('account.saveChanges')}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}

function PasswordCard() {
    const { t } = useTranslation();
    const { user, refetch } = useAuth();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const isSettingFirst = !user?.has_password;

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setError('');
        setSuccess('');
        if (next !== confirm) { setError(t('account.passwordsMismatch')); return; }
        setSaving(true);
        try {
            const endpoint = isSettingFirst ? '/auth/set-password' : '/auth/change-password';
            const body = isSettingFirst
                ? { password: next }
                : { currentPassword: current, newPassword: next };

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to update password');
            setSuccess(isSettingFirst ? t('account.passwordSet') : t('account.passwordChanged'));
            setCurrent('');
            setNext('');
            setConfirm('');
            await refetch();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    {isSettingFirst ? t('account.setPassword') : t('account.changePassword')}
                </CardTitle>
                <CardDescription>
                    {isSettingFirst ? t('account.setPasswordDescription') : t('account.changePasswordDescription')}
                </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
                <CardContent className="space-y-4">
                    {!isSettingFirst && (
                        <div className="grid gap-2">
                            <Label htmlFor="currentPassword">{t('account.currentPassword')}</Label>
                            <Input
                                id="currentPassword"
                                type="password"
                                value={current}
                                onChange={(e) => setCurrent(e.target.value)}
                                required
                            />
                        </div>
                    )}
                    <div className="grid gap-2">
                        <Label htmlFor="newPassword">{t('account.newPassword')}</Label>
                        <Input
                            id="newPassword"
                            type="password"
                            value={next}
                            onChange={(e) => setNext(e.target.value)}
                            minLength={6}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="confirmPassword">{t('account.confirmPassword')}</Label>
                        <Input
                            id="confirmPassword"
                            type="password"
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            minLength={6}
                            required
                        />
                    </div>
                    <SectionFeedback error={error} success={success} />
                </CardContent>
                <CardFooter>
                    <Button type="submit" disabled={saving}>
                        {saving ? t('common.saving') : isSettingFirst ? t('account.setPassword') : t('account.changePassword')}
                    </Button>
                </CardFooter>
            </form>
        </Card>
    );
}

function ConnectedAccountsCard() {
    const { t } = useTranslation();
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    async function handleConnectGoogle(accessToken: string) {
        setError('');
        setSuccess('');
        setLoading(true);
        try {
            const res = await fetch('/auth/connect-google', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token: accessToken }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to connect Google account');
            setSuccess(t('account.googleConnected'));
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    if (!googleClientId) return null;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t('account.connectedAccounts')}</CardTitle>
                <CardDescription>
                    {t('account.connectedAccountsDescription')}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <SectionFeedback error={error} success={success} />
                <GoogleAuthButton
                    label={t('account.connectGoogle')}
                    disabled={loading}
                    onSuccess={handleConnectGoogle}
                    onError={() => setError(t('account.googleAuthFailed'))}
                />
            </CardContent>
        </Card>
    );
}

export default function Account() {
    const { t } = useTranslation();
    const { user } = useAuth();

    if (!user) return null;

    return (
        <div className="max-w-lg space-y-6">
            <div>
                <h1 className="text-2xl font-semibold">{t('account.heading')}</h1>
                <p className="text-sm text-muted-foreground mt-1">{user.email}</p>
            </div>
            <Separator />
            <ProfileCard />
            <PasswordCard />
            <ConnectedAccountsCard />
        </div>
    );
}
