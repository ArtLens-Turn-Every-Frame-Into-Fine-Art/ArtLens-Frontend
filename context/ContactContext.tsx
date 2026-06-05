/**
 * context/ContactContext.tsx
 *
 * Globalises contact-form state and the API submission so any screen can
 * trigger a contact submission without duplicating fetch logic.
 *
 * Usage:
 *   const { submit, isSubmitting, error, success, reset } = useContact();
 */

import React, {
	createContext,
	useCallback,
	useContext,
	useState,
	ReactNode,
} from 'react'
import { submitContactForm } from '../services/api'
import { ContactPayload } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactState {
	isSubmitting: boolean
	/** Last successful response message from the server. */
	successMessage: string | null
	/** Last error message (network or validation). */
	error: string | null
}

interface ContactContextValue extends ContactState {
	/**
	 * Submit the contact form.
	 * Returns the server response on success, or null on failure
	 * (error is set in state).
	 */
	submit: (
		data: ContactPayload
	) => Promise<{ success: boolean; message: string } | null>
	/** Clear success/error state (e.g. when the user navigates away). */
	reset: () => void
}

// ── Context ───────────────────────────────────────────────────────────────────

const ContactContext = createContext<ContactContextValue | undefined>(undefined)

// ── Provider ──────────────────────────────────────────────────────────────────

export const ContactProvider: React.FC<{ children: ReactNode }> = ({
	children,
}) => {
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [successMessage, setSuccessMessage] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const submit = useCallback(
		async (
			data: ContactPayload
		): Promise<{ success: boolean; message: string } | null> => {
			setIsSubmitting(true)
			setError(null)
			setSuccessMessage(null)

			try {
				const response = await submitContactForm(data)
				setSuccessMessage(response.message)
				return response
			} catch (err: unknown) {
				const msg =
					err instanceof Error
						? err.message
						: 'Failed to send message. Please try again.'
				setError(msg)
				return null
			} finally {
				setIsSubmitting(false)
			}
		},
		[]
	)

	const reset = useCallback(() => {
		setSuccessMessage(null)
		setError(null)
	}, [])

	return (
		<ContactContext.Provider
			value={{ isSubmitting, successMessage, error, submit, reset }}
		>
			{children}
		</ContactContext.Provider>
	)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useContact = (): ContactContextValue => {
	const ctx = useContext(ContactContext)
	if (!ctx)
		throw new Error('useContact must be used within a ContactProvider')
	return ctx
}
