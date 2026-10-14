import { Component, type ReactNode } from 'react'

/**
 * Erro de tela não derruba o sistema inteiro: mostra o que aconteceu (para mandar ao
 * suporte) e deixa recarregar. O menu continua funcionando.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(previous: { resetKey?: string }) {
    // Trocar de tela limpa o erro.
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-xl space-y-3 rounded-xl border border-red-500/40 bg-card p-6 text-sm">
        <h2 className="text-lg font-semibold text-foreground">Esta tela encontrou um erro</h2>
        <p className="text-muted-foreground">
          Os dados não foram perdidos. Recarregue a página; se o erro continuar, envie a mensagem abaixo ao suporte.
        </p>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs text-foreground">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          Recarregar
        </button>
      </div>
    )
  }
}
