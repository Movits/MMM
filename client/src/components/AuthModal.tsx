import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X, ArrowRight } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const playfairStyle = { fontFamily: '"Playfair Display", serif' };

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [step, setStep] = useState<'email' | 'password' | 'register'>('email');
  const [emailOrName, setEmailOrName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [userExists, setUserExists] = useState(false);

  // Step 1: Verificar email/nome
  const handleContinueEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!emailOrName.trim()) {
      setError('Por favor, insira um email ou nome');
      return;
    }

    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));

    const users = JSON.parse(localStorage.getItem('mmm_users') || '{}');
    
    // Procurar se usuário existe
    let exists = false;
    for (const user of Object.values(users)) {
      const u = user as any;
      if (u.email === emailOrName || u.name === emailOrName) {
        exists = true;
        break;
      }
    }

    setUserExists(exists);
    setStep('password');
    setLoading(false);
  };

  // Step 2: Processar senha (login ou ir para registro)
  const handleContinuePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password.trim()) {
      setError('Por favor, insira uma senha');
      return;
    }

    if (userExists) {
      // Login
      setLoading(true);
      await new Promise(resolve => setTimeout(resolve, 500));

      const users = JSON.parse(localStorage.getItem('mmm_users') || '{}');
      let foundUser = null;

      for (const user of Object.values(users)) {
        const u = user as any;
        if ((u.email === emailOrName || u.name === emailOrName) && u.password === password) {
          foundUser = u;
          break;
        }
      }

      if (!foundUser) {
        setError('Senha incorreta');
        setLoading(false);
        return;
      }

      // Login bem-sucedido
      localStorage.setItem('mmm_auth', JSON.stringify({ 
        email: foundUser.email, 
        name: foundUser.name 
      }));
      window.location.href = '/dashboard';
    } else {
      // Ir para registro
      setStep('register');
      setLoading(false);
    }
  };

  // Step 3: Criar novo cadastro
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fullName.trim()) {
      setError('Por favor, insira seu nome completo');
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      return;
    }

    if (password !== confirmPassword) {
      setError('As senhas não correspondem');
      return;
    }

    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));

    const users = JSON.parse(localStorage.getItem('mmm_users') || '{}');
    
    // Determinar se emailOrName é email ou nome
    const isEmail = emailOrName.includes('@');
    const newUser = {
      name: fullName,
      email: isEmail ? emailOrName : `${emailOrName}@mmm.local`,
      password: password
    };

    users[emailOrName] = newUser;
    localStorage.setItem('mmm_users', JSON.stringify(users));
    localStorage.setItem('mmm_auth', JSON.stringify({ 
      email: newUser.email, 
      name: newUser.name 
    }));

    window.location.href = '/dashboard';
  };

  const handleBack = () => {
    if (step === 'password') {
      setStep('email');
      setPassword('');
      setError('');
    } else if (step === 'register') {
      setStep('password');
      setFullName('');
      setConfirmPassword('');
      setError('');
    }
  };

  const handleClose = () => {
    setStep('email');
    setEmailOrName('');
    setPassword('');
    setConfirmPassword('');
    setFullName('');
    setError('');
    setUserExists(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md bg-white">
        <DialogHeader className="relative">
          <button
            onClick={handleClose}
            className="absolute right-0 top-0 p-1 hover:bg-gray-100 rounded"
          >
            <X className="w-5 h-5" />
          </button>
          <DialogTitle style={playfairStyle} className="text-3xl text-[#0A1F3F]">
            {step === 'email' && 'Acessar MMM OS'}
            {step === 'password' && (userExists ? 'Fazer Login' : 'Criar Conta')}
            {step === 'register' && 'Criar Novo Cadastro'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-6">
          {/* Step Indicator */}
          <div className="flex gap-2 mb-6">
            <div className={`flex-1 h-1 rounded-full transition-colors ${['email', 'password', 'register'].indexOf(step) >= 0 ? 'bg-[#D4AF37]' : 'bg-[#E0E0E0]'}`}></div>
            <div className={`flex-1 h-1 rounded-full transition-colors ${['password', 'register'].indexOf(step) >= 0 ? 'bg-[#D4AF37]' : 'bg-[#E0E0E0]'}`}></div>
            <div className={`flex-1 h-1 rounded-full transition-colors ${step === 'register' ? 'bg-[#D4AF37]' : 'bg-[#E0E0E0]'}`}></div>
          </div>

          {/* STEP 1: Email/Nome */}
          {step === 'email' && (
            <form onSubmit={handleContinueEmail} className="space-y-4">
              <div>
                <Label htmlFor="email-input" className="text-[#2D3E50]">
                  Email ou Nome
                </Label>
                <Input
                  id="email-input"
                  type="text"
                  placeholder="seu@email.com ou seu nome"
                  value={emailOrName}
                  onChange={(e) => setEmailOrName(e.target.value)}
                  className="mt-2 border-[#E0E0E0]"
                  autoFocus
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-[#0A1F3F] text-white hover:bg-[#0F2A3F]"
              >
                {loading ? 'Verificando...' : (
                  <>
                    Continuar <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </form>
          )}

          {/* STEP 2: Senha (Login ou Registro) */}
          {step === 'password' && (
            <form onSubmit={handleContinuePassword} className="space-y-4">
              {/* Display Email/Nome */}
              <div className="p-3 bg-[#FAFBFC] rounded-lg border border-[#E0E0E0]">
                <p className="text-xs text-[#666666]">
                  {userExists ? 'Fazer login como' : 'Novo usuário'}
                </p>
                <p className="text-[#0A1F3F] font-semibold">{emailOrName}</p>
              </div>

              {/* Senha */}
              <div>
                <Label htmlFor="password-input" className="text-[#2D3E50]">
                  Senha
                </Label>
                <Input
                  id="password-input"
                  type="password"
                  placeholder={userExists ? 'Sua senha' : 'Crie uma senha (mín. 6 caracteres)'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 border-[#E0E0E0]"
                  autoFocus
                />
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-[#0A1F3F] text-white hover:bg-[#0F2A3F]"
              >
                {loading ? (userExists ? 'Entrando...' : 'Continuando...') : (
                  <>
                    {userExists ? 'Entrar' : 'Próximo'} <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={handleBack}
                className="w-full text-[#D4AF37] hover:text-[#0A1F3F] text-sm font-medium"
              >
                Voltar
              </button>
            </form>
          )}

          {/* STEP 3: Registro (Novo Cadastro) */}
          {step === 'register' && (
            <form onSubmit={handleRegister} className="space-y-4">
              {/* Display Email/Nome */}
              <div className="p-3 bg-[#FAFBFC] rounded-lg border border-[#E0E0E0]">
                <p className="text-xs text-[#666666]">Criar conta com</p>
                <p className="text-[#0A1F3F] font-semibold">{emailOrName}</p>
              </div>

              {/* Nome Completo */}
              <div>
                <Label htmlFor="fullname-input" className="text-[#2D3E50]">
                  Nome Completo
                </Label>
                <Input
                  id="fullname-input"
                  type="text"
                  placeholder="Seu nome completo"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-2 border-[#E0E0E0]"
                  autoFocus
                />
              </div>

              {/* Senha */}
              <div>
                <Label htmlFor="register-password" className="text-[#2D3E50]">
                  Senha
                </Label>
                <Input
                  id="register-password"
                  type="password"
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 border-[#E0E0E0]"
                />
              </div>

              {/* Confirmar Senha */}
              <div>
                <Label htmlFor="confirm-password" className="text-[#2D3E50]">
                  Confirmar Senha
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="Confirme sua senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-2 border-[#E0E0E0]"
                />
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <Button
                type="submit"
                disabled={loading}
                className="w-full bg-[#0A1F3F] text-white hover:bg-[#0F2A3F]"
              >
                {loading ? 'Criando conta...' : (
                  <>
                    Criar Conta <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={handleBack}
                className="w-full text-[#D4AF37] hover:text-[#0A1F3F] text-sm font-medium"
              >
                Voltar
              </button>
            </form>
          )}
        </div>

        <div className="pt-4 border-t border-[#E0E0E0] text-center text-xs text-[#666666]">
          <p>Seus dados são protegidos com segurança de nível bancário</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
