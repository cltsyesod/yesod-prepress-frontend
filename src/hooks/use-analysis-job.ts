import { useState, useEffect, useCallback, useRef } from 'react'
import pb from '@/lib/pocketbase/client'
import {
  analysisJobsService,
  type AnalysisJob,
  type AnalysisIssue,
} from '@/services/analysisJobsService'
import { analysisIssuesService } from '@/services/analysisIssuesService'
import { useRealtime } from '@/hooks/use-realtime'
import { getErrorMessage } from '@/lib/pocketbase/errors'

const FINAL_STATES = ['completed', 'completed_with_warnings', 'failed', 'cancelled']
const POLL_INTERVAL = 10000

export function useAnalysisJob(fileId: string | null) {
  const [job, setJob] = useState<AnalysisJob | null>(null)
  const [issues, setIssues] = useState<AnalysisIssue[]>([])
  const [loading, setLoading] = useState(!!fileId)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  jobIdRef.current = job?.id ?? null

  const loadJob = useCallback(async () => {
    if (!fileId) {
      setLoading(false)
      return
    }
    try {
      const record = await pb
        .collection('analysis_jobs')
        .getFirstListItem(`file = "${fileId}"`, { sort: '-created' })
      const jobData = record as unknown as AnalysisJob
      setJob(jobData)
      jobIdRef.current = jobData.id
      const issuesData = await analysisJobsService.getAnalysisIssues(jobData.id)
      setIssues(issuesData)
    } catch {
      setJob(null)
      setIssues([])
      jobIdRef.current = null
    }
    setLoading(false)
  }, [fileId])

  useEffect(() => {
    setLoading(true)
    loadJob()
  }, [loadJob])

  const refreshIssues = useCallback(async () => {
    if (!jobIdRef.current) return
    try {
      const issuesData = await analysisJobsService.getAnalysisIssues(jobIdRef.current)
      setIssues(issuesData)
    } catch {
      /* noop */
    }
  }, [])

  useRealtime(
    'analysis_jobs',
    (e) => {
      const recordFile = (e.record as Record<string, unknown>)?.file
      const recordFileId = typeof recordFile === 'string' ? recordFile : ''
      if (recordFileId !== fileId) return
      const newJob = e.record as unknown as AnalysisJob
      setJob(newJob)
      jobIdRef.current = newJob.id
      if (FINAL_STATES.includes(newJob.status)) {
        refreshIssues()
      }
    },
    !!fileId,
  )

  useRealtime(
    'analysis_issues',
    (e) => {
      const recordAnalysis = (e.record as Record<string, unknown>)?.analysis
      const recordAnalysisId = typeof recordAnalysis === 'string' ? recordAnalysis : ''
      if (recordAnalysisId !== job?.id) return
      refreshIssues()
    },
    !!job?.id,
  )

  useEffect(() => {
    if (!job || FINAL_STATES.includes(job.status)) return
    const interval = setInterval(async () => {
      if (!jobIdRef.current) return
      try {
        const status = await analysisJobsService.getAnalysisStatus(jobIdRef.current)
        setJob((prev) => (prev ? { ...prev, ...status } : null))
        if (FINAL_STATES.includes(status.status)) {
          refreshIssues()
        }
      } catch {
        /* noop */
      }
    }, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [job?.id, job?.status, refreshIssues])

  const startAnalysis = useCallback(
    async (profileId: string) => {
      if (!fileId || starting) return
      setStarting(true)
      setError(null)
      try {
        await analysisJobsService.startAnalysis(fileId, {
          productionProfile: { id: profileId },
        })
        await loadJob()
      } catch (err) {
        setError(getErrorMessage(err))
      }
      setStarting(false)
    },
    [fileId, starting, loadJob],
  )

  const cancelAnalysis = useCallback(async () => {
    if (!jobIdRef.current) return
    setActionError(null)
    try {
      await analysisJobsService.cancelAnalysis(jobIdRef.current)
      await loadJob()
    } catch (err) {
      setActionError(getErrorMessage(err))
    }
  }, [loadJob])

  const retryAnalysis = useCallback(async () => {
    if (!jobIdRef.current) return
    setActionError(null)
    try {
      await analysisJobsService.retryAnalysis(jobIdRef.current)
      await loadJob()
    } catch (err) {
      setActionError(getErrorMessage(err))
    }
  }, [loadJob])

  const updateIssueStatus = useCallback(
    async (issueId: string, status: string, reason?: string) => {
      setActionError(null)
      setIssues((prev) =>
        prev.map((i) =>
          i.id === issueId
            ? {
                ...i,
                status: status as AnalysisIssue['status'],
                decision_reason: reason || '',
                decision_at: new Date().toISOString(),
              }
            : i,
        ),
      )
      try {
        await analysisIssuesService.updateStatus(issueId, status, reason)
      } catch (err) {
        setActionError(getErrorMessage(err))
        refreshIssues()
        throw err
      }
    },
    [refreshIssues],
  )

  return {
    job,
    issues,
    loading,
    starting,
    error,
    actionError,
    startAnalysis,
    cancelAnalysis,
    retryAnalysis,
    updateIssueStatus,
  }
}
