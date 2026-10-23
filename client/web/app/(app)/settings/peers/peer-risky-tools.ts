/**
 * The risky tools a peer bound to the owner may be allowed by name, as flags.
 * The brain keeps no list of them to fetch: a tool is risky when its policy
 * says `peerRisky` (the owner MCP surface, A5 step 6a), and the PATCH takes
 * any name of the right shape. So this is a HARD-CODED copy of the brain's
 * list (mantle v0.300.135, mcp-core's surface-decisions snapshot: every tool
 * with `peerRisky` and a gate), grouped for the screen. A stopgap: the
 * proper fix is a brain endpoint that lists them, so the screen reads them
 * live. Until then a new risky tool on the brain shows here only once added.
 *
 * The brain keeps at most 64 names per peer (MAX_RISKY_TOOLS) while it has
 * more risky tools than that, so the screen counts down and stops at 64.
 *
 * A saved name the catalog does not hold (a connector's tool, a tool a later
 * brain adds) is never hidden: it shows as a flag under "Other", and a name
 * can be added there by hand. A name the brain does not register allows
 * nothing, so a stale catalog entry is harmless.
 */

export type RiskyGroup = {
  id: string;
  label: string;
  /** What the group lets the peer do, in a line. */
  hint: string;
  tools: readonly string[];
};

export const RISKY_TOOL_GROUPS: readonly RiskyGroup[] = [
  {
    id: 'messages',
    label: 'Email and Telegram',
    hint: 'Sends messages from your accounts.',
    tools: [
      'email_send',
      'email_page',
      'telegram_send',
      'telegram_edit',
      'telegram_react',
      'telegram_pair',
      'telegram_pending',
      'telegram_mark_processed',
    ],
  },
  {
    id: 'web',
    label: 'Web',
    hint: 'Searches and fetches the web on this brain’s keys.',
    tools: ['web_search', 'web_search_pro', 'web_fetch', 'web_crawl', 'web_map'],
  },
  {
    id: 'sandboxes',
    label: 'Sandboxes and shell',
    hint: 'Runs code and commands on this box.',
    tools: [
      'run_terminal',
      'sandbox_create',
      'sandbox_exec',
      'sandbox_autostart',
      'sandbox_list',
      'sandbox_ls',
      'sandbox_export',
      'sandbox_import',
      'sandbox_mcp_tools',
      'sandbox_mcp_call',
      'sandbox_publish',
      'sandbox_stop',
      'sandbox_rm',
    ],
  },
  {
    id: 'agents',
    label: 'Assistants and paid model work',
    hint: 'Starts model work that spends, or changes how assistants run.',
    tools: [
      'invoke_agent',
      'ask_responder',
      'ask_as_responder',
      'responder_turn_input',
      'responder_turn_record',
      'run_plan',
      'run_append',
      'video_ingest',
      'agent_set_thinking_effort',
      'agent_grant_tool_group',
      'model_pool_set',
      'model_pool_remove',
      'update_persona',
      'search_chunks',
      'summarize_text',
      'generate_image',
      'extract_from_image',
      'recall_eval',
    ],
  },
  {
    id: 'sharing',
    label: 'Sharing and access',
    hint: 'Shares content, changes who may see it, or publishes.',
    tools: ['access_set', 'node_share', 'page_share', 'contact_create', 'contact_update'],
  },
  {
    id: 'deletes',
    label: 'Deletes and restores',
    hint: 'Deletes content, or rolls a table back to a snapshot.',
    tools: [
      'page_delete',
      'table_delete',
      'table_snapshot_delete',
      'table_snapshot_restore',
      'journal_delete',
      'contact_delete',
    ],
  },
  {
    id: 'apps',
    label: 'Mini apps',
    hint: 'Builds, changes, publishes, imports or deletes mini apps.',
    tools: [
      'app_create',
      'app_update',
      'app_source_set',
      'app_file_write',
      'app_file_delete',
      'app_build',
      'app_publish',
      'app_tools_set',
      'app_db_schema_set',
      'app_db_seed',
      'app_table_export_set',
      'app_table_export_remove',
      'app_duplicate',
      'app_export',
      'app_import',
      'app_snapshot_create',
      'app_snapshot_delete',
      'app_snapshot_restore',
      'app_delete',
      'app_undelete',
    ],
  },
  {
    id: 'approvals',
    label: 'Approvals',
    hint: 'Approves or rejects actions waiting for your confirm.',
    tools: ['pending_approve', 'pending_reject'],
  },
  {
    id: 'tooling',
    label: 'Tools and secrets',
    hint: 'Builds or changes tools, and stores secrets.',
    tools: [
      'api_tool_create',
      'api_tool_update',
      'api_tool_delete',
      'api_tool_test',
      'api_docs_set',
      'api_skill_set',
      'recipe_tool_create',
      'recipe_tool_test',
      'tool_group_ensure',
      'secret_create',
    ],
  },
  {
    id: 'peers',
    label: 'Other brains',
    hint: 'Reaches a third brain on this brain’s links.',
    tools: [
      'peer_list',
      'peer_query',
      'peer_search_chunks',
      'peer_node_get',
      'peer_tools',
      'peer_call',
      'peer_file_copy',
    ],
  },
];

/** The id of the group that holds saved names the catalog does not know. */
export const OTHER_GROUP_ID = 'other';

/** The most names a peer may be allowed (the PATCH's own limit,
 *  peer-access.ts `.max(64)`): fewer than the catalog holds. */
export const MAX_RISKY_TOOLS = 64;

/** How many more names this peer may be allowed. */
export function riskyLeft(saved: readonly string[]): number {
  return Math.max(0, MAX_RISKY_TOOLS - new Set(saved).size);
}

/** A name the brain accepts (peer-access.ts RiskyName). */
export function isRiskyToolName(name: string): boolean {
  return /^[a-z][a-z0-9_]{1,63}$/.test(name);
}

const KNOWN = new Set(RISKY_TOOL_GROUPS.flatMap((g) => g.tools));

/** The groups to draw for these saved names: the catalog, then "Other"
 *  with every saved name the catalog lacks (absent when there is none). */
export function riskyGroupsFor(saved: readonly string[]): RiskyGroup[] {
  const others = [...new Set(saved.filter((n) => !KNOWN.has(n)))].sort();
  if (others.length === 0) return [...RISKY_TOOL_GROUPS];
  return [
    ...RISKY_TOOL_GROUPS,
    {
      id: OTHER_GROUP_ID,
      label: 'Other',
      hint: 'Allowed by name: a connector’s tool, or one this screen does not list.',
      tools: others,
    },
  ];
}

/** The saved list with these names turned on or off, in a stable order
 *  (catalog order, then the rest sorted), each name once. */
export function withRisky(
  saved: readonly string[],
  names: readonly string[],
  on: boolean,
): string[] {
  const set = new Set(saved);
  for (const n of names) {
    if (on) set.add(n);
    else set.delete(n);
  }
  const order = RISKY_TOOL_GROUPS.flatMap((g) => g.tools);
  const known = order.filter((n) => set.has(n));
  const rest = [...set].filter((n) => !KNOWN.has(n)).sort();
  return [...known, ...rest];
}
