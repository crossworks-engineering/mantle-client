'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@mantle/web-ui/api-fetch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@mantle/web-ui/ui/dialog';
import { Spinner } from '@mantle/web-ui/ui/spinner';
import { ProfileDescriptionControl } from '@/components/profile-description-control';
import { useViewerLogin } from '@/components/workspaces/use-shell-workspaces';
import type { PersonCard } from '@/lib/messenger/dto';

/**
 * A login without the Profile screen (a member) says who it is to the team
 * here, opened from the account menu. The current text is read from its own
 * card (GET /api/people/:id, open to every login), the save is the same
 * control the Profile screen holds (PUT /api/profile/description).
 */
export function MemberDescriptionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useViewerLogin()?.loginId;
  const card = useQuery({
    queryKey: ['people', me],
    queryFn: () => apiFetch<{ person: PersonCard }>(`/api/people/${me}`),
    enabled: open && !!me,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Your description</DialogTitle>
          <DialogDescription>
            A line on your card so the team and its agents know who you are.
          </DialogDescription>
        </DialogHeader>
        {card.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <ProfileDescriptionControl
            // Remounted per card read, so it starts from what is stored.
            key={card.dataUpdatedAt}
            initial={card.data?.person.description ?? ''}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
