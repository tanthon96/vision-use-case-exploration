import { useEffect } from 'react'
import { useSkillsStore } from '../stores/skillsStore'
import { useWorkspaceStore } from '../stores/workspaceStore'

/**
 * Pulls the workspace-scoped skills list when the active workspace changes.
 */
export function useSkills() {
  const store = useSkillsStore()
  const workspaceId = useWorkspaceStore((s) => s.currentId)

  useEffect(() => {
    store.setWorkspaceId(workspaceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  return store
}
