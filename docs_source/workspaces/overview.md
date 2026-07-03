---
slug: workspaces-overview
title: Workspaces
section: workspaces
summary: A workspace is a provider, a template, a materialised instance, and the sessions that run on it; here is how those four pieces fit together.
---

## The four pieces

A workspace gives an agent a real place to work: a filesystem it can read and write, a shell it can run commands in, and a git-backed `.state/` history. Four concepts share the workspace namespace:

- **Provider**: the backend configuration: which runtime (local filesystem, container daemon, Kubernetes cluster) and how to reach it.
- **Template**: the materialisation recipe that references a provider: which image or base path, environment variables, initial files, and init commands.
- **Instance**: the live, materialised sandbox created from a template. Many instances can come from one template.
- **Sessions**: the runs hosted on an instance. One instance hosts many sessions at once.

The **workspace toolset** lets agents manage all of the above programmatically, and **yielding tools** let a session park on an external event and resume when it fires.

## Working in a workspace: the Studio

The console gives every workspace its own **Studio**, an IDE-like view you open from the **Studio** item in the left nav or by opening a workspace from the **Workspaces** list. It has three columns:

- **Left sidebar**: a **Sessions** list, where the `+` starts a new run, and a **Files** tree over the instance filesystem.
- **Center**: a tabbed work area. Sessions open as tabs, files open in an editor tab, and an integrated terminal opens in its own tab.
- **Right activity panel**: a live stream of workspace events and an **Action required** list for sessions that are waiting on you.

The **Files** tree exposes the same operations the workspace toolset offers over the API: open and edit a file, create a **New file** or **New folder**, **Upload** files from your machine, **Download** a file, and **Delete** a file or folder (folders delete recursively). A gear button opens **Settings** for the workspace: channels, config, the run log, and destroy.

```ref:workspaces/workspaces-and-sessions
Start and monitor sessions inside the Studio, and the session lifecycle.
```

```ref:workspaces/workspace-providers
Register local, container, and Kubernetes workspace providers.
```

```ref:workspaces/workspace-templates
Author templates that materialise workspaces from a provider.
```

```ref:workspaces/workspaces-and-sessions
How a workspace instance hosts sessions, and the session lifecycle.
```

```ref:workspaces/workspace-toolset
The workspace toolset agents use to manage providers, templates, workspaces, and sessions.
```

```ref:workspaces/yielding-tools
How a session parks on a tool call and resumes when the event fires.
```
