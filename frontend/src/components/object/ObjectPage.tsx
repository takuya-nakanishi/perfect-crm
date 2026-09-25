import {
  ArrowUpDown,
  Download,
  Ellipsis,
  Funnel,
  ListFilter,
  Menu,
  PanelLeft,
  Plus,
  Settings,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import type {
  Filter,
  ListViewConfig,
  MetaResponse,
  ObjectMeta,
  Sort,
  ViewInput,
  ViewMeta,
} from "@/api/types";
import { FilterBar, SortMenu } from "@/components/view/FilterBar";
import { ViewTabs } from "@/components/view/ViewTabs";
import { useViewMutations } from "@/data/views";
import { newViewInput, toInput, uniqueName } from "@/lib/viewModel";
import { Button, IconButton, Kbd, ObjectIcon } from "@/components/ui/basics";
import { Popover } from "@/components/ui/overlay";
import { exportTable } from "@/data/exportTable";
import { findObject, useSession, viewsOf } from "@/data/queries";
import { useDebounced } from "@/lib/useDebounced";
import { useUI } from "@/state/ui";
import { ListView } from "./ListView";

// カンバン(ドラッグ&ドロップのライブラリを含む)とレポートは、最初の表示に要らないので別のファイルに分ける。
// 開いてすぐ裏で読み込んでおくので、タブを切り替えたときには手元にある
const loadKanban = () => import("./KanbanView");
const loadReport = () => import("./ReportView");
const KanbanView = lazy(() =>
  loadKanban().then((m) => ({ default: m.KanbanView })),
);
// ビューの設定(並べ替えのライブラリを含む)も、開くときに読む
const ViewSettings = lazy(() =>
  import("@/components/view/ViewSettings").then((m) => ({
    default: m.ViewSettings,
  })),
);
const ReportView = lazy(() =>
  loadReport().then((m) => ({ default: m.ReportView })),
);

/** 歯車のメニュー: テーブル設定(環境設定へ。管理者だけ)・インポート・エクスポート */
function TableMenu({ object }: { object: ObjectMeta }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const admin = Boolean(useSession().data?.user.admin);
  const openImport = useUI((s) => s.openImport);
  const itemCls =
    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-ink hover:bg-sunken";
  const pick = (run: () => void) => () => {
    setAnchor(null);
    run();
  };
  return (
    <>
      <IconButton
        label={`${object.label}の設定`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        className="size-8"
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        <Settings size={15} />
      </IconButton>
      {anchor && (
        <Popover
          anchor={anchor}
          onClose={() => setAnchor(null)}
          align="end"
          width={208}
        >
          <div role="menu" className="p-1.5">
            {admin && (
              <button
                type="button"
                role="menuitem"
                className={itemCls}
                onClick={pick(() =>
                  navigate(`/settings/tables?object=${object.key}`),
                )}
              >
                <SlidersHorizontal
                  size={15}
                  className="text-ink-2"
                  aria-hidden
                />
                テーブル設定
                <span className="ml-auto text-xs text-ink-3">環境設定</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              autoFocus={!admin}
              className={itemCls}
              onClick={pick(() => openImport(object.key))}
            >
              <Upload size={15} className="text-ink-2" aria-hidden />
              インポート
            </button>
            <button
              type="button"
              role="menuitem"
              className={itemCls}
              onClick={pick(() => void exportTable(object))}
            >
              <Download size={15} className="text-ink-2" aria-hidden />
              エクスポート
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** テーブル 1 つぶんの画面。上にビューのタブ、下に選んだビュー(一覧・カンバン・レポート) */
export function ObjectPage({ meta }: { meta: MetaResponse }) {
  const { objectKey } = useParams();
  const [params, setParams] = useSearchParams();
  const [filterText, setFilterText] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [conditionsOpen, setConditionsOpen] = useState<{
    pick: boolean;
  } | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<HTMLElement | null>(
    null,
  );
  const viewMutations = useViewMutations();
  const navigate = useNavigate();
  const q = useDebounced(filterText.trim(), 150);
  const sidebarCollapsed = useUI((s) => s.sidebarCollapsed);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const setMobileNav = useUI((s) => s.setMobileNav);
  const openCreate = useUI((s) => s.openCreate);
  const openQuickAdd = useUI((s) => s.openQuickAdd);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadKanban();
      void loadReport();
    }, 800);
    return () => clearTimeout(t);
  }, []);

  const object = findObject(meta, objectKey);
  if (!object) return <Navigate to="/" replace />;

  const views = viewsOf(meta, object.key);
  const view = views.find((v) => v.id === params.get("view")) ?? views[0];
  const isTasks = Boolean(object.completion);

  const selectView = (id: string) => {
    setConditionsOpen(null);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("view", id);
      return next;
    });
  };

  // ビューの操作。どれもその場で保存する(data/views.ts)
  const saveView = (
    v: ViewMeta,
    patch: { name?: string; pin?: ViewMeta["pin"] },
  ) => viewMutations.save(v, { ...toInput(v), ...patch } as ViewInput);
  /** 一覧・カンバンの config の一部を変える(フィルター・並び替え、一覧の列の幅) */
  const saveConfig = (
    v: ViewMeta & { type: "list" | "kanban" },
    patch: {
      filter?: Filter;
      sort?: Sort[];
      columns?: ListViewConfig["columns"];
    },
  ) => {
    const input = toInput(v) as ViewInput & { type: "list" | "kanban" };
    viewMutations.save(v, {
      ...input,
      config: { ...input.config, ...patch },
    } as ViewInput);
  };
  const addView = async (type: "list" | "kanban", base?: ViewMeta) => {
    const name = base
      ? uniqueName(`${base.name}のコピー`, views)
      : uniqueName(type === "list" ? "一覧" : "カンバン", views);
    const input = base
      ? { ...toInput(base), name, pin: undefined }
      : newViewInput(object, type, name);
    if (!input) return;
    const id = await viewMutations.create(object.key, input);
    if (id) navigate(`/o/${object.key}?view=${id}`);
  };
  const removeView = (v: ViewMeta) => {
    viewMutations.remove(v);
    setSettingsAnchor(null);
    const rest = views.filter((x) => x.id !== v.id);
    if (v.id === view?.id && rest[0]) selectView(rest[0].id);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex-none border-b border-line">
        <div className="flex h-12 items-center gap-2 pr-3 pl-3 md:pl-5">
          <IconButton
            label="メニューを開く"
            className="md:hidden"
            onClick={() => setMobileNav(true)}
          >
            <Menu size={17} />
          </IconButton>
          {sidebarCollapsed && (
            <IconButton
              label="サイドバーを開く (M)"
              className="hidden md:inline-grid"
              onClick={toggleSidebar}
            >
              <PanelLeft size={16} />
            </IconButton>
          )}
          <ObjectIcon icon={object.icon} color={object.color} size={16} />
          <h1 className="truncate text-lg font-bold">{object.label}</h1>

          <div className="ml-auto flex items-center gap-1.5">
            {/*
              絞り込み欄は、開いたときにだけ描く。幅を 0 から広げる作りにすると、広がりきる前の打鍵で
              Chromium がキャレットを先頭に置き続け、文字が逆順に入る(F を押してすぐ打つと起きた)
            */}
            {view && view.type !== "report" && (
              <>
                <IconButton
                  label="フィルター(条件を足す)"
                  className="size-8"
                  aria-pressed={
                    Boolean(conditionsOpen) || Boolean(view.config.filter)
                  }
                  onClick={() => setConditionsOpen({ pick: true })}
                >
                  <Funnel size={15} />
                </IconButton>
                <IconButton
                  label="並び替え"
                  className="size-8"
                  aria-pressed={Boolean(view.config.sort?.length)}
                  onClick={(e) => setSortAnchor(e.currentTarget)}
                >
                  <ArrowUpDown size={15} />
                </IconButton>
                <IconButton
                  label="ビューの設定"
                  className="size-8"
                  onClick={(e) => setSettingsAnchor(e.currentTarget)}
                >
                  <Ellipsis size={15} />
                </IconButton>
                <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
              </>
            )}
            {view?.type !== "report" && !filterOpen && !filterText && (
              <IconButton
                id="table-filter-toggle"
                label="文字で絞り込む (F)"
                className="size-8"
                onClick={() => setFilterOpen(true)}
              >
                <ListFilter size={15} />
              </IconButton>
            )}
            {view?.type !== "report" && (filterOpen || filterText) && (
              <label className="flex h-8 w-44 items-center gap-1.5 rounded-md pr-1 pl-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line-strong)] focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)] sm:w-56">
                <ListFilter size={15} className="flex-none" aria-hidden />
                <input
                  id="table-filter"
                  autoFocus
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  onBlur={() => setFilterOpen(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                      e.stopPropagation();
                      setFilterText("");
                      e.currentTarget.blur();
                    }
                  }}
                  placeholder={`${object.label}を絞り込む`}
                  aria-label={`${object.label}を絞り込む`}
                  className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
                />
                {filterText && (
                  <button
                    type="button"
                    aria-label="絞り込みを空にする"
                    onClick={() => setFilterText("")}
                    className="grid size-6 flex-none place-items-center rounded hover:bg-sunken"
                  >
                    <X size={13} />
                  </button>
                )}
              </label>
            )}
            <TableMenu object={object} />
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                isTasks ? openQuickAdd() : openCreate(object.key)
              }
            >
              <Plus size={14} strokeWidth={2.5} aria-hidden />
              <span className="hidden sm:inline">
                {isTasks ? "タスクを追加" : "新規"}
              </span>
              <span className="hidden opacity-80 lg:inline">
                <Kbd>{isTasks ? "Q" : "N"}</Kbd>
              </span>
            </Button>
          </div>
        </div>

        <ViewTabs
          object={object}
          views={views}
          activeId={view?.id}
          onSelect={selectView}
          onAdd={(type) => void addView(type)}
          onRename={(v, name) => saveView(v, { name })}
          onDuplicate={(v) =>
            void addView(v.type === "kanban" ? "kanban" : "list", v)
          }
          onTogglePin={(v) =>
            saveView(v, {
              pin: v.pin
                ? undefined
                : {
                    label: v.name,
                    position: 999,
                    show_count: v.type === "list",
                  },
            })
          }
          onDelete={removeView}
          onOpenSettings={(_v, anchor) => setSettingsAnchor(anchor)}
        />
        {view && view.type !== "report" && (
          <FilterBar
            meta={meta}
            object={object}
            view={view}
            open={conditionsOpen}
            onChange={(filter) => saveConfig(view, { filter })}
          />
        )}
      </header>

      {view && view.type !== "report" && sortAnchor && (
        <SortMenu
          anchor={sortAnchor}
          object={object}
          sort={view.config.sort ?? []}
          onClose={() => setSortAnchor(null)}
          onChange={(sort) => saveConfig(view, { sort })}
        />
      )}
      {view && settingsAnchor && (
        <Suspense fallback={null}>
          <ViewSettings
            anchor={settingsAnchor}
            meta={meta}
            object={object}
            view={view}
            onClose={() => setSettingsAnchor(null)}
            onChange={(input) => viewMutations.save(view, input)}
            onDelete={() => removeView(view)}
          />
        </Suspense>
      )}
      {view?.type === "list" && (
        <ListView
          key={view.id}
          meta={meta}
          object={object}
          config={view.config}
          q={q}
          viewName={view.name}
          onColumnsChange={(columns) => saveConfig(view, { columns })}
        />
      )}
      <Suspense fallback={null}>
        {view?.type === "kanban" && (
          <KanbanView
            key={view.id}
            meta={meta}
            object={object}
            config={view.config}
            q={q}
            viewName={view.name}
          />
        )}
        {view?.type === "report" && (
          <ReportView key={view.id} object={object} config={view.config} />
        )}
      </Suspense>
    </div>
  );
}
