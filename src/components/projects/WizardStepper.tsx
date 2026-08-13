import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WizardStepperProps {
  currentStep: number
}

const STEPS = [
  { number: 1, label: 'Informações' },
  { number: 2, label: 'Produção' },
  { number: 3, label: 'Arquivos' },
  { number: 4, label: 'Revisão' },
]

export function WizardStepper({ currentStep }: WizardStepperProps) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 mb-8">
      {STEPS.map((step, i) => (
        <div key={step.number} className="flex items-center">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center justify-center h-9 w-9 rounded-full text-sm font-medium border-2 transition-colors',
                currentStep === step.number
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : currentStep > step.number
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'bg-white border-slate-300 text-slate-400',
              )}
            >
              {currentStep > step.number ? <Check className="h-4 w-4" /> : step.number}
            </div>
            <span
              className={cn(
                'text-sm font-medium hidden sm:inline',
                currentStep === step.number ? 'text-slate-800' : 'text-slate-500',
              )}
            >
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div
              className={cn(
                'h-0.5 w-6 sm:w-12 mx-1 transition-colors',
                currentStep > step.number ? 'bg-green-500' : 'bg-slate-200',
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}
