import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, RefreshCw, KeyRound, Trash2 } from 'lucide-react';
import { Button } from '@/UI/button';
import { Input } from '@/UI/input';
import { Label } from '@/UI/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/UI/card';
import { apiFetch } from '@/lib/apiFetch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/UI/alert-dialog';

interface ApiKeys {
  clientId: string;
  clientSecret: string;
  createdAt: string;
  updatedAt: string;
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return (json.data ?? json) as T;
}

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeys | null>(null);
  const [loading, setLoading] = useState(true);
  const [secretVisible, setSecretVisible] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualClientId, setManualClientId] = useState('');
  const [manualClientSecret, setManualClientSecret] = useState('');

  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const [copied, setCopied] = useState<'id' | 'secret' | null>(null);

  useEffect(() => {
    apiFetch('/api/settings/api-keys')
      .then(r => r.json())
      .then(d => setKeys(d.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function generate() {
    setSaving(true); setError('');
    try {
      const result = await req<ApiKeys>('/api/settings/api-keys/generate', { method: 'POST' });
      setKeys(result); setSecretVisible(true);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); setConfirmGenerate(false); }
  }

  async function saveManual() {
    setSaving(true); setError('');
    try {
      const result = await req<ApiKeys>('/api/settings/api-keys', {
        method: 'PUT',
        body: JSON.stringify({ clientId: manualClientId.trim(), clientSecret: manualClientSecret.trim() }),
      });
      setKeys(result); setSecretVisible(true); setManualOpen(false);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function revoke() {
    setSaving(true); setError('');
    try {
      await apiFetch('/api/settings/api-keys', { method: 'DELETE' });
      setKeys(null); setSecretVisible(false);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); setConfirmRevoke(false); }
  }

  function copy(value: string, field: 'id' | 'secret') {
    navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  }

  if (loading) return null;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="size-4" /> API Keys</CardTitle>
          <CardDescription>
            Client credentials for this project. Use these to authenticate remote applications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}

          {keys ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Client ID</Label>
                <div className="flex gap-2">
                  <Input readOnly value={keys.clientId} className="font-mono text-sm" />
                  <Button variant="outline" size="icon" onClick={() => copy(keys.clientId, 'id')} title="Copy">
                    <Copy className="size-4" />
                    {copied === 'id' && <span className="sr-only">Copied</span>}
                  </Button>
                </div>
                {copied === 'id' && <p className="text-xs text-muted-foreground">Copied!</p>}
              </div>

              <div className="space-y-1">
                <Label>Client Secret</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    type={secretVisible ? 'text' : 'password'}
                    value={keys.clientSecret}
                    className="font-mono text-sm"
                  />
                  <Button variant="outline" size="icon" onClick={() => setSecretVisible(v => !v)} title={secretVisible ? 'Hide' : 'Show'}>
                    {secretVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => copy(keys.clientSecret, 'secret')} title="Copy">
                    <Copy className="size-4" />
                  </Button>
                </div>
                {copied === 'secret' && <p className="text-xs text-muted-foreground">Copied!</p>}
              </div>

              <p className="text-xs text-muted-foreground">
                Last updated: {new Date(keys.updatedAt).toLocaleString()}
              </p>

              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmGenerate(true)} disabled={saving}>
                  <RefreshCw className="size-4 mr-2" /> Regenerate
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setManualClientId(keys.clientId); setManualClientSecret(keys.clientSecret); setManualOpen(true); }} disabled={saving}>
                  Edit manually
                </Button>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive ml-auto" onClick={() => setConfirmRevoke(true)} disabled={saving}>
                  <Trash2 className="size-4 mr-2" /> Revoke
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">No API keys generated yet for this project.</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => generate()} disabled={saving}>
                  <KeyRound className="size-4 mr-2" /> Generate keys
                </Button>
                <Button variant="outline" size="sm" onClick={() => { setManualClientId(''); setManualClientSecret(''); setManualOpen(true); }} disabled={saving}>
                  Set manually
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual input dialog */}
      <AlertDialog open={manualOpen} onOpenChange={setManualOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set API keys manually</AlertDialogTitle>
            <AlertDialogDescription>Enter your own client ID and secret.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Client ID</Label>
              <Input value={manualClientId} onChange={e => setManualClientId(e.target.value)} placeholder="client-id" className="font-mono" />
            </div>
            <div className="space-y-1">
              <Label>Client Secret</Label>
              <Input value={manualClientSecret} onChange={e => setManualClientSecret(e.target.value)} placeholder="client-secret" className="font-mono" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={saveManual} disabled={saving || !manualClientId.trim() || !manualClientSecret.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Regenerate confirmation */}
      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate API keys?</AlertDialogTitle>
            <AlertDialogDescription>
              This will invalidate the existing keys immediately. Any remote applications using them will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={generate} disabled={saving}>Regenerate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke confirmation */}
      <AlertDialog open={confirmRevoke} onOpenChange={setConfirmRevoke}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API keys?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the keys for this project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={revoke}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
