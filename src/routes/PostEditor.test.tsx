// @vitest-environment jsdom
/**
 * Integration tests for the post editor's draft-persistence behaviour. These
 * mount the real <PostEditor> with the real query hooks, reducer, drafts module
 * and (jsdom) localStorage — only the network layer (repo.ts), auth, CodeMirror
 * and analytics are mocked. That's the level the draft bugs lived at:
 *
 *   - a saved draft being wiped by the load race before it could restore,
 *   - the dirty state (and draft) not clearing after a save,
 *   - drafts not restoring on reload.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest"
import { draftKey } from "../lib/drafts.ts"
import { buildMarkpubContent } from "../lib/markpub.ts"
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  listPublications,
  putDocument,
} from "../lib/repo.ts"
import { PostEditor } from "./PostEditor.tsx"

const TEST_DID = "did:plc:test"
const PUB_RKEY = "pub1"
const PUB = {
  uri: `at://${TEST_DID}/site.standard.publication/${PUB_RKEY}`,
  cid: "cid-pub1",
  rkey: PUB_RKEY,
  value: { name: "Test Blog", url: "https://blog.test" },
}

// --- mocks ---

vi.mock("../auth/AuthProvider.tsx", () => ({
  useAuth: () => ({
    did: TEST_DID,
    client: {},
    status: "signed-in",
    profile: null,
    signOut: vi.fn(),
  }),
}))

// CodeMirror needs DOM measurement that jsdom can't do; a plain textarea honours
// the same value/onChange contract the editor relies on.
vi.mock("@uiw/react-codemirror", () => ({
  EditorView: { lineWrapping: {} },
  default: ({
    value,
    onChange,
  }: {
    value: string
    onChange?: (v: string) => void
  }) => (
    <textarea
      aria-label="body"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}))

// @plausible-analytics/tracker is aliased to a stub in vite.config (test).

// Keep the pure repo helpers (templatizePath, documentBelongsTo, …); mock only
// the functions that hit the network.
vi.mock("../lib/repo.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/repo.ts")>()),
  listPublications: vi.fn(),
  listDocuments: vi.fn(),
  getDocument: vi.fn(),
  createDocument: vi.fn(),
  putDocument: vi.fn(),
  deleteDocument: vi.fn(),
  uploadImageBlob: vi.fn(),
}))

// --- mutable "server" state, so saves are reflected by the post-save refetch ---

interface DocValue {
  site: string
  title: string
  path: string
  publishedAt: string
  content: unknown
  description?: string
  tags?: string[]
  updatedAt?: string
}
let serverDocs: Record<string, DocValue>
let cidCounter: number

function docEntry(rkey: string) {
  return {
    uri: `at://${TEST_DID}/site.standard.document/${rkey}`,
    cid: `cid-${rkey}-${cidCounter}`,
    rkey,
    value: serverDocs[rkey],
  }
}

beforeEach(() => {
  localStorage.clear()
  cidCounter = 0
  serverDocs = {
    abc: {
      site: PUB.uri,
      title: "Original Title",
      path: "/post/abc",
      publishedAt: "2026-01-01T00:00:00.000Z",
      content: buildMarkpubContent("Original body"),
    },
  }
  ;(listPublications as Mock).mockResolvedValue([PUB])
  ;(listDocuments as Mock).mockImplementation(async () =>
    Object.keys(serverDocs).map(docEntry),
  )
  ;(getDocument as Mock).mockImplementation(async (_c: unknown, rkey: string) =>
    docEntry(rkey),
  )
  ;(putDocument as Mock).mockImplementation(
    async (_c: unknown, rkey: string, value: DocValue) => {
      cidCounter++
      serverDocs[rkey] = { ...value }
    },
  )
  ;(createDocument as Mock).mockImplementation(
    async (_c: unknown, value: DocValue, rkey: string) => {
      cidCounter++
      serverDocs[rkey] = { ...value }
      return { uri: docEntry(rkey).uri, rkey }
    },
  )
  ;(deleteDocument as Mock).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderEditor(path: string, qc?: QueryClient) {
  const client =
    qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div>dashboard</div>} />
          <Route path="/post/new" element={<PostEditor />} />
          <Route path="/post/:rkey" element={<PostEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { client, ...utils }
}

/** Resolve once the editor has loaded and seeded the given body. */
async function waitForBody(text: string) {
  const body = await screen.findByLabelText("body")
  await waitFor(() => expect(body).toHaveValue(text))
  return body as HTMLTextAreaElement
}

describe("PostEditor draft persistence", () => {
  it("persists a draft to localStorage as you type", async () => {
    renderEditor("/post/abc")
    const body = await waitForBody("Original body")

    fireEvent.change(body, { target: { value: "Original body, edited" } })

    const key = draftKey(TEST_DID, "abc")
    await waitFor(() => expect(localStorage.getItem(key)).toBeTruthy(), {
      timeout: 2000,
    })
    expect(JSON.parse(localStorage.getItem(key)!).body).toBe(
      "Original body, edited",
    )
    expect(screen.getByText(/draft saved locally/i)).toBeInTheDocument()
  })

  it("restores a draft after a reload (fresh query cache, persisted storage)", async () => {
    const first = renderEditor("/post/abc")
    const body = await waitForBody("Original body")
    fireEvent.change(body, { target: { value: "Unsaved work" } })

    const key = draftKey(TEST_DID, "abc")
    await waitFor(() => expect(localStorage.getItem(key)).toBeTruthy(), {
      timeout: 2000,
    })

    // Simulate a reload: tear down, then remount with a *fresh* QueryClient so
    // the in-memory cache is gone but localStorage persists.
    first.unmount()
    renderEditor("/post/abc")

    await waitForBody("Unsaved work")
    expect(screen.getByText(/restored unsaved changes/i)).toBeInTheDocument()
    // The load race must not have wiped it.
    expect(localStorage.getItem(key)).toBeTruthy()
  })

  it("clears the dirty state and the draft after saving", async () => {
    renderEditor("/post/abc")
    const body = await waitForBody("Original body")
    const save = screen.getByRole("button", { name: /^save$/i })
    expect(save).toBeDisabled()

    fireEvent.change(body, { target: { value: "Edited body" } })
    expect(save).toBeEnabled()

    const key = draftKey(TEST_DID, "abc")
    await waitFor(() => expect(localStorage.getItem(key)).toBeTruthy(), {
      timeout: 2000,
    })

    fireEvent.click(save)

    await waitFor(() => expect(putDocument as Mock).toHaveBeenCalled())
    // The regression: saving must drop the draft and clear the dirty state.
    await waitFor(() => expect(save).toBeDisabled())
    expect(localStorage.getItem(key)).toBeNull()
    expect(screen.getByText(/saved to your pds/i)).toBeInTheDocument()

    // …and it must not resurrect: still gone after the debounce window.
    await new Promise((r) => setTimeout(r, 700))
    expect(localStorage.getItem(key)).toBeNull()
  })

  it("discards the draft and reverts to the published version", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    renderEditor("/post/abc")
    const body = await waitForBody("Original body")

    fireEvent.change(body, { target: { value: "Throwaway" } })
    const key = draftKey(TEST_DID, "abc")
    await waitFor(() => expect(localStorage.getItem(key)).toBeTruthy(), {
      timeout: 2000,
    })

    fireEvent.click(screen.getByRole("button", { name: /discard/i }))

    await waitFor(() => expect(body).toHaveValue("Original body"))
    expect(localStorage.getItem(key)).toBeNull()
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled()
  })

  it("persists and restores a new-post draft under the publication key", async () => {
    const first = renderEditor("/post/new")
    const headline = await screen.findByPlaceholderText("Headline")
    fireEvent.change(headline, { target: { value: "Draft headline" } })
    fireEvent.change(screen.getByLabelText("body"), {
      target: { value: "Draft body" },
    })

    const key = draftKey(TEST_DID, { newPub: PUB_RKEY })
    await waitFor(() => expect(localStorage.getItem(key)).toBeTruthy(), {
      timeout: 2000,
    })

    first.unmount()
    renderEditor("/post/new")

    const headline2 = await screen.findByPlaceholderText("Headline")
    await waitFor(() => expect(headline2).toHaveValue("Draft headline"))
    expect(screen.getByLabelText("body")).toHaveValue("Draft body")
  })
})
