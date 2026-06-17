import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  onOpenChange?: (v: boolean) => void
  onCancel?: () => void
  title: string
  description: string
  onConfirm: () => void
  loading?: boolean
  confirmLabel?: string
  variant?: 'destructive' | 'default'
}

export function ConfirmDialog({
  open, onOpenChange, onCancel, title, description, onConfirm, loading, confirmLabel = 'Confirmar', variant = 'destructive',
}: Props) {
  const handleClose = (v: boolean) => {
    if (!v) { onCancel?.(); onOpenChange?.(false) }
    else onOpenChange?.(true)
  }
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button variant={variant} onClick={onConfirm} disabled={loading}>
            {loading ? 'Aguarde...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
