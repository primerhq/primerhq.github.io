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

The console gives every workspace its own **Studio**, an IDE-like view you open from the **Studio** item in the left nav or by opening a workspace from the **Workspaces** list.

The Studio is arranged around one question: **does anything need me right now?**

**The attention bar** sits under the header and is always present. It says whether a run is waiting on you and whether anything is working, in plain words: `Nothing needs you` when you are clear, or what is blocked with a way straight to it. It is the first thing to read, and usually the only thing you need.

**One rail, two modes.** The left is a single column with a **Runs** tab and a **Files** tab, rather than two stacked lists competing for the same height.

- **Runs** lists the workspace's sessions, filtered by **All**, **Needs you**, or **Open**. The `+` starts a new run. Each row carries its status, and hovering offers **Open beside**, **Rename**, and **Delete**.
- **Files** is a tree over the instance filesystem, exposing the same operations the workspace toolset offers over the API: open and edit a file, create a **New file** or **New folder**, **Upload** from your machine, **Download**, and **Delete** (folders delete recursively).

**The center** is a tabbed work area. A session opens as a tab with its transcript, and a graph run also shows the run view and its superstep strip. A file opens in an editor tab. **Open beside** puts a tab in a **companion pane** next to the current one, which is how you read a diff against the transcript that produced it. The companion pane exists exactly when it holds something: close its last tab and it goes away.

**The investigate dock** rises from the bottom on `Ctrl` and a backtick, or from the terminal button in the header. It holds **Events** (the live workspace stream), **Problems**, and terminal sessions as tabs. It is where you look when something seems wrong, and it stays collapsed until then.

**Changes**, in the header, answers "what did the agents actually write": the files a run touched, with diffs, and a **Mark reviewed** as you work through them.

The header also carries the workspace selector, a command palette on `Cmd-K` (or `Ctrl-K`), and a gear for **Settings**: channels, config, the run log, and destroy.

```callout:tip
A run blocked on a particular tool call has a shareable link: the URL carries a `?focus=` value, so sending it to a colleague opens the Studio on exactly the thing that is stuck rather than on the session in general.
```

On a phone the Studio is a triage view rather than a shrunk desktop. You get what is waiting on you and enough to unblock it, without the file tree or the terminal.

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
