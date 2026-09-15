import { useState, useMemo, useEffect } from "react";
import { useSync } from "./hooks/useSync";
import "./App.css";

const DEFAULT_SERVER_URL = "https://176.169.48.104:58410";

function cleanUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export default function App() {
  const {
    config,
    loadConfig,
    status,
    launchStatus,
    isRunning,
    isLaunching,
    isGameRunning,
    error,
    startSync,
    launchMinecraft,
    // Auth
    auth,
    authLoading,
    authError,
    loginAccount,
    registerAccount,
    logout,
    setAuthError,
  } = useSync();

  const [currentScreen, setCurrentScreen] = useState<"main" | "settings">("main");

  // Auth form state
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Allocation RAM exacte en Mo (saisie libre, ex: 4096, 5120, 6144...)
  const [ramMb, setRamMb] = useState<number>(() => {
    const saved = localStorage.getItem("mc_ram_mb");
    return saved ? Math.max(1024, parseInt(saved, 10)) : 4096;
  });

  // Emplacement personnalisé & URL API
  const [gameDirInput, setGameDirInput] = useState<string>(() => {
    return localStorage.getItem("mc_game_dir") || "";
  });
  const [modsUrlInput, setModsUrlInput] = useState<string>(() => {
    return localStorage.getItem("mc_mods_url") || "";
  });

  useEffect(() => {
    localStorage.setItem("mc_ram_mb", ramMb.toString());
  }, [ramMb]);

  useEffect(() => {
    localStorage.setItem("mc_game_dir", gameDirInput);
  }, [gameDirInput]);

  useEffect(() => {
    localStorage.setItem("mc_mods_url", modsUrlInput);
  }, [modsUrlInput]);

  const isBusy = isRunning || isLaunching;

  // Calcul du pourcentage global
  const activeProgress = useMemo(() => {
    if (isLaunching) return Math.min(100, Math.max(0, launchStatus.progress));
    if (isRunning) return Math.min(100, Math.max(0, status.total_progress));
    if (status.step === "done") return 100;
    return 0;
  }, [isLaunching, isRunning, launchStatus.progress, status.total_progress, status.step]);

  // Message d'état affiché
  const activeMessage = useMemo(() => {
    if (isLaunching) return launchStatus.message || "Lancement de Minecraft...";
    if (isRunning) return status.message;
    if (isGameRunning) return "Minecraft 1.21.1 est en cours d'exécution.";
    if (status.step === "done") return "Fichiers vérifiés et à jour.";
    return "Prêt à jouer.";
  }, [isLaunching, isRunning, isGameRunning, launchStatus.message, status.message, status.step]);

  // Déclencheur du bouton JOUER
  const handlePlay = async () => {
    const customUrl = cleanUrl(modsUrlInput);
    const customDir = gameDirInput.trim() || undefined;

    // 1. Synchronisation des mods
    const syncSuccess = await startSync(customUrl, customDir);
    if (!syncSuccess) {
      return;
    }

    // 2. Lancement du jeu (username vient du token vérifié côté serveur)
    await launchMinecraft(ramMb, customDir, customUrl);
  };

  const handleRamChange = (delta: number) => {
    setRamMb((prev) => Math.max(1024, prev + delta));
  };

  // Auth form submit
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);

    if (!authUsername.trim()) {
      setAuthError("Le pseudo est requis.");
      return;
    }
    if (!authPassword) {
      setAuthError("Le mot de passe est requis.");
      return;
    }

    if (authMode === "register") {
      if (authPassword !== authConfirmPassword) {
        setAuthError("Les mots de passe ne correspondent pas.");
        return;
      }
      if (authPassword.length < 4) {
        setAuthError("Le mot de passe doit faire au moins 4 caractères.");
        return;
      }
    }

    setAuthSubmitting(true);
    const customUrl = cleanUrl(modsUrlInput);
    let success = false;
    if (authMode === "login") {
      success = await loginAccount(authUsername.trim(), authPassword, customUrl);
    } else {
      success = await registerAccount(authUsername.trim(), authPassword, customUrl);
    }

    if (success) {
      setAuthUsername("");
      setAuthPassword("");
      setAuthConfirmPassword("");
    }
    setAuthSubmitting(false);
  };

  // Switch between login/register
  const toggleAuthMode = () => {
    setAuthMode((m) => (m === "login" ? "register" : "login"));
    setAuthError(null);
    setAuthConfirmPassword("");
  };

  // Fermer les paramètres et rafraîchir la config
  const handleCloseSettings = () => {
    const customUrl = cleanUrl(modsUrlInput);
    const customDir = gameDirInput.trim() || undefined;
    loadConfig(customUrl, customDir);
    setCurrentScreen("main");
  };

  const effectiveServerUrl = modsUrlInput.trim() || config?.mods_url || DEFAULT_SERVER_URL;

  return (
    <div className="launcher-window">
      {/* En-tête Minecraft */}
      <header className="mc-header">
        <h1 className="mc-title">THIRD WORLD</h1>
        <div className="mc-subtitle">
          <span>MINECRAFT 1.21.1</span>
          <span>•</span>
          <span>NEOFORGE 21.1.250</span>
        </div>
      </header>

      {/* ===== VUE PARAMÈTRES (Accessible connecté OU non-connecté) ===== */}
      {currentScreen === "settings" ? (
        <main className="mc-main-area">
          <div className="mc-box">
            <h2 className="mc-auth-title">PARAMÈTRES DU LAUNCHER</h2>

            {/* RAM */}
            <div className="mc-input-group">
              <label className="mc-label">MÉMOIRE VIVE ALLOUÉE (RAM) :</label>
              <div className="mc-ram-control">
                <button
                  className="mc-btn mc-btn-stepper"
                  type="button"
                  onClick={() => handleRamChange(-512)}
                >
                  -
                </button>
                <input
                  className="mc-input mc-ram-input"
                  type="number"
                  step="512"
                  min="1024"
                  max="32768"
                  value={ramMb}
                  onChange={(e) => setRamMb(Math.max(1024, parseInt(e.target.value, 10) || 1024))}
                />
                <button
                  className="mc-btn mc-btn-stepper"
                  type="button"
                  onClick={() => handleRamChange(512)}
                >
                  +
                </button>
                <span className="mc-ram-gb">
                  Mo ({(ramMb / 1024).toFixed(1)} Go)
                </span>
              </div>
              <div className="mc-input-hint">
                Valeur exacte transmise à Java via -Xmx{ramMb}M
              </div>
            </div>

            {/* Emplacement du jeu */}
            <div className="mc-input-group" style={{ marginTop: "16px" }}>
              <label className="mc-label">EMPLACEMENT DU JEU :</label>
              <input
                className="mc-input"
                type="text"
                placeholder={config?.game_dir || "%APPDATA%/.serveur-info"}
                value={gameDirInput}
                onChange={(e) => setGameDirInput(e.target.value)}
              />
              <div className="mc-input-hint">
                Défaut : <code>%APPDATA%/.serveur-info</code> (ou variable <code>LAUNCHER_GAME_DIR</code>)
              </div>
            </div>

            {/* URL de l'API / Manifest */}
            <div className="mc-input-group" style={{ marginTop: "16px" }}>
              <label className="mc-label">ADRESSE DU SERVEUR / API :</label>
              <input
                className="mc-input"
                type="text"
                placeholder={DEFAULT_SERVER_URL}
                value={modsUrlInput}
                onChange={(e) => setModsUrlInput(e.target.value)}
              />
              <div className="mc-input-hint">
                Défaut : <code>{DEFAULT_SERVER_URL}</code>
              </div>
            </div>

            {/* Bouton Retour */}
            <button
              className="mc-btn mc-btn-play"
              style={{ width: "100%", marginTop: "20px" }}
              onClick={handleCloseSettings}
            >
              TERMINÉ & ENREGISTRER
            </button>
          </div>
        </main>
      ) : !auth.isLoggedIn ? (
        /* ===== VUE AUTH (Non-connecté) ===== */
        <main className="mc-main-area">
          <div className="mc-box mc-auth-box">
            {authLoading ? (
              <div className="mc-auth-loading">
                <div className="mc-spinner" />
                <span>Vérification de la session...</span>
              </div>
            ) : (
              <>
                <h2 className="mc-auth-title">
                  {authMode === "login" ? "CONNEXION" : "INSCRIPTION"}
                </h2>

                <form className="mc-auth-form" onSubmit={handleAuthSubmit}>
                  <div className="mc-input-group">
                    <label className="mc-label" htmlFor="auth-username">
                      PSEUDO :
                    </label>
                    <input
                      id="auth-username"
                      className="mc-input"
                      type="text"
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      disabled={authSubmitting}
                      maxLength={16}
                      placeholder="Ex: Steve"
                      autoComplete="username"
                      autoFocus
                    />
                    {authMode === "register" && (
                      <div className="mc-input-hint">
                        Lettres, chiffres et underscores uniquement (3-16 caractères)
                      </div>
                    )}
                  </div>

                  <div className="mc-input-group">
                    <label className="mc-label" htmlFor="auth-password">
                      MOT DE PASSE :
                    </label>
                    <input
                      id="auth-password"
                      className="mc-input"
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      disabled={authSubmitting}
                      placeholder="••••••••"
                      autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    />
                  </div>

                  {authMode === "register" && (
                    <div className="mc-input-group">
                      <label className="mc-label" htmlFor="auth-confirm-password">
                        CONFIRMER LE MOT DE PASSE :
                      </label>
                      <input
                        id="auth-confirm-password"
                        className="mc-input"
                        type="password"
                        value={authConfirmPassword}
                        onChange={(e) => setAuthConfirmPassword(e.target.value)}
                        disabled={authSubmitting}
                        placeholder="••••••••"
                        autoComplete="new-password"
                      />
                    </div>
                  )}

                  {authError && (
                    <div className="mc-error-banner">
                      [ERREUR] {authError}
                    </div>
                  )}

                  <button
                    className="mc-btn mc-btn-play"
                    type="submit"
                    disabled={authSubmitting}
                  >
                    {authSubmitting
                      ? "CHARGEMENT..."
                      : authMode === "login"
                        ? "SE CONNECTER"
                        : "CRÉER LE COMPTE"}
                  </button>
                </form>

                <button
                  className="mc-btn mc-btn-toggle-auth"
                  onClick={toggleAuthMode}
                  disabled={authSubmitting}
                >
                  {authMode === "login"
                    ? "Pas de compte ? Créer un compte"
                    : "Déjà un compte ? Se connecter"}
                </button>

                <button
                  type="button"
                  className="mc-btn mc-btn-auth-settings"
                  onClick={() => setCurrentScreen("settings")}
                  disabled={authSubmitting}
                >
                  ⚙ PARAMÈTRES DU SERVEUR
                </button>
              </>
            )}
          </div>
        </main>
      ) : (
        /* ===== VUE PRINCIPALE (Connecté) ===== */
        <main className="mc-main-area">
          <div className="mc-box">
            {/* Info joueur connecté */}
            <div className="mc-player-info">
              <div className="mc-player-badge">
                <span className="mc-player-avatar">⛏</span>
                <span className="mc-player-name">{auth.username}</span>
              </div>
              <button
                className="mc-btn mc-btn-logout"
                onClick={logout}
                disabled={isBusy}
              >
                DÉCONNEXION
              </button>
            </div>

            {/* Barre de progression style Minecraft */}
            {(isBusy || status.step === "done") && (
              <div className="mc-progress-box">
                <div
                  className="mc-progress-fill"
                  style={{ width: `${activeProgress}%` }}
                />
              </div>
            )}

            {/* Statut sous forme de chat Minecraft */}
            <div className="mc-status-text">
              <span>&gt; {activeMessage}</span>
              {isBusy && <span>{Math.round(activeProgress)}%</span>}
            </div>

            {/* Fichier en cours de téléchargement */}
            {isRunning && status.current_file && (
              <div className="mc-current-file">
                Téléchargement : <span>{status.current_file}</span>
                {status.total_files > 0 && (
                  <span style={{ color: "var(--mc-gray)", marginLeft: "8px" }}>
                    ({status.current_index}/{status.total_files})
                  </span>
                )}
              </div>
            )}

            {/* Message d'erreur éventuel */}
            {error && (
              <div className="mc-error-banner">
                [ERREUR] {error}
              </div>
            )}

            {/* Actions principales */}
            <div className="mc-actions">
              <button
                className="mc-btn mc-btn-play"
                onClick={handlePlay}
                disabled={isBusy || isGameRunning}
              >
                {isGameRunning
                  ? "JEU EN COURS"
                  : isLaunching
                    ? "LANCEMENT..."
                    : isRunning
                      ? "SYNCHRONISATION..."
                      : "JOUER"}
              </button>

              <div className="mc-secondary-actions">
                <button
                  className="mc-btn mc-btn-secondary"
                  onClick={() => setCurrentScreen("settings")}
                  disabled={isBusy}
                >
                  PARAMÈTRES
                </button>
                <button
                  className="mc-btn mc-btn-secondary"
                  onClick={() => {
                    const customUrl = cleanUrl(modsUrlInput);
                    const customDir = gameDirInput.trim() || undefined;
                    startSync(customUrl, customDir);
                  }}
                  disabled={isBusy}
                >
                  VÉRIFIER LES MODS
                </button>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* Pied de page Minecraft */}
      <footer className="mc-footer">
        <div>
          <span>Serveur : </span>
          <span style={{ color: "var(--mc-white)" }}>
            {effectiveServerUrl}
          </span>
        </div>
        <div className="mc-footer-right">
          {isGameRunning && (
            <div className="mc-badge-running">
              [EN JEU]
            </div>
          )}
          <span className="mc-badge-secure">🔒 HTTPS</span>
        </div>
      </footer>
    </div>
  );
}
