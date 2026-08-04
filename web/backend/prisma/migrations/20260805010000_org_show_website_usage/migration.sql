-- Org-wide switch for the Reports page's "Website usage" panel. Defaults to
-- true so existing workspaces see no change until an admin turns it off.
ALTER TABLE "Organization" ADD COLUMN "showWebsiteUsage" BOOL NOT NULL DEFAULT true;
