import { describe, expect, it } from 'vitest';
import {
  isRiskyToolName,
  MAX_RISKY_TOOLS,
  OTHER_GROUP_ID,
  RISKY_TOOL_GROUPS,
  riskyGroupsFor,
  riskyLeft,
  withRisky,
} from './peer-risky-tools';

/** The brain's list this catalog copies (mantle v0.300.135, mcp-core's
 *  surface-decisions snapshot: every tool whose policy says `peerRisky`,
 *  with a gate). A copy, so this pins the catalog to what was copied; a
 *  brain endpoint that lists them is the proper fix. */
const BRAIN_RISKY = [
  'access_set',
  'agent_grant_tool_group',
  'agent_set_thinking_effort',
  'api_docs_set',
  'api_skill_set',
  'api_tool_create',
  'api_tool_delete',
  'api_tool_test',
  'api_tool_update',
  'app_build',
  'app_create',
  'app_db_schema_set',
  'app_db_seed',
  'app_delete',
  'app_duplicate',
  'app_export',
  'app_file_delete',
  'app_file_write',
  'app_import',
  'app_publish',
  'app_snapshot_create',
  'app_snapshot_delete',
  'app_snapshot_restore',
  'app_source_set',
  'app_table_export_remove',
  'app_table_export_set',
  'app_tools_set',
  'app_undelete',
  'app_update',
  'ask_as_responder',
  'ask_responder',
  'contact_create',
  'contact_delete',
  'contact_update',
  'email_page',
  'email_send',
  'extract_from_image',
  'generate_image',
  'invoke_agent',
  'journal_delete',
  'model_pool_remove',
  'model_pool_set',
  'node_share',
  'page_delete',
  'page_share',
  'peer_call',
  'peer_file_copy',
  'peer_list',
  'peer_node_get',
  'peer_query',
  'peer_search_chunks',
  'peer_tools',
  'pending_approve',
  'pending_reject',
  'recall_eval',
  'recipe_tool_create',
  'recipe_tool_test',
  'responder_turn_input',
  'responder_turn_record',
  'run_append',
  'run_plan',
  'run_terminal',
  'sandbox_autostart',
  'sandbox_create',
  'sandbox_exec',
  'sandbox_export',
  'sandbox_import',
  'sandbox_list',
  'sandbox_ls',
  'sandbox_mcp_call',
  'sandbox_mcp_tools',
  'sandbox_publish',
  'sandbox_rm',
  'sandbox_stop',
  'search_chunks',
  'secret_create',
  'summarize_text',
  'table_delete',
  'table_snapshot_delete',
  'table_snapshot_restore',
  'telegram_edit',
  'telegram_mark_processed',
  'telegram_pair',
  'telegram_pending',
  'telegram_react',
  'telegram_send',
  'tool_group_ensure',
  'update_persona',
  'video_ingest',
  'web_crawl',
  'web_fetch',
  'web_map',
  'web_search',
  'web_search_pro',
];

const catalog = RISKY_TOOL_GROUPS.flatMap((g) => g.tools);

describe('the risky tool catalog', () => {
  it('holds every risky tool of the brain, each once', () => {
    expect([...catalog].sort()).toEqual([...BRAIN_RISKY].sort());
    expect(new Set(catalog).size).toBe(catalog.length);
  });

  it('holds valid names, more than one peer may be allowed', () => {
    expect(catalog.every(isRiskyToolName)).toBe(true);
    // The brain has more risky tools than its per-peer limit: the screen
    // counts down instead of offering them all at once.
    expect(catalog.length).toBeGreaterThan(MAX_RISKY_TOOLS);
  });
});

describe('isRiskyToolName', () => {
  it('takes the brain’s shape only', () => {
    expect(isRiskyToolName('mcp_github_create_issue')).toBe(true);
    expect(isRiskyToolName('Web_search')).toBe(false);
    expect(isRiskyToolName('web-search')).toBe(false);
    expect(isRiskyToolName('w')).toBe(false);
  });
});

describe('riskyGroupsFor', () => {
  it('is the catalog when every saved name is known', () => {
    expect(riskyGroupsFor(['web_search']).map((g) => g.id)).toEqual(
      RISKY_TOOL_GROUPS.map((g) => g.id),
    );
  });

  it('keeps a saved name the catalog lacks visible, under Other', () => {
    const groups = riskyGroupsFor(['web_search', 'mcp_x_send', 'mcp_a_post', 'mcp_x_send']);
    const other = groups.at(-1);
    expect(other?.id).toBe(OTHER_GROUP_ID);
    expect(other?.tools).toEqual(['mcp_a_post', 'mcp_x_send']);
  });
});

describe('withRisky', () => {
  it('turns names on and off, each once, in catalog order then the rest', () => {
    expect(
      withRisky(['mcp_z', 'web_fetch'], ['web_search', 'email_send', 'web_fetch'], true),
    ).toEqual(['email_send', 'web_search', 'web_fetch', 'mcp_z']);
    expect(withRisky(['web_search', 'mcp_z'], ['mcp_z'], false)).toEqual(['web_search']);
  });

  it('turns a whole group off', () => {
    const web = RISKY_TOOL_GROUPS.find((g) => g.id === 'web')!.tools;
    expect(withRisky([...web, 'email_send'], web, false)).toEqual(['email_send']);
  });
});

describe('riskyLeft', () => {
  it('counts down from the limit, a name once, never below zero', () => {
    expect(riskyLeft([])).toBe(MAX_RISKY_TOOLS);
    expect(riskyLeft(['web_search', 'web_search', 'email_send'])).toBe(MAX_RISKY_TOOLS - 2);
    expect(riskyLeft(catalog)).toBe(0);
  });
});
