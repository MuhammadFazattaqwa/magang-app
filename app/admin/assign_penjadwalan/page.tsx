// app/admin/assign_penjadwalan/page.tsx
"use client";

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AdminHeader } from "@/components/admin-header";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle,
  Calendar,
  Plus,
  Edit,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/apiFetch";

/* ================== Types ================== */
type ProjectStatus = "unassigned" | "ongoing" | "pending";
type ProgressStatus = "ongoing" | "completed" | "overdue";

type UITechnician = { id: string; name: string; initial: string };

type DbProjectWithStats = {
  id: string;
  job_id: string;
  name: string;
  status: ProgressStatus;
  project_status: ProjectStatus;
  pending_reason: string | null;
  sigma_hari: number | null;
  sigma_teknisi: number | null;
  sigma_man_days: number | null;
  jam_datang: string | null;
  jam_pulang: string | null;
  days_elapsed: number | null;
  created_at: string;
  assignment_count: number;
  leader_count: number;
  actual_man_days: number | null;
  sales?: string | null;
  sales_name?: string | null;
  nama_sales?: string | null;
};

type UIProject = {
  id: string; // UUID
  name: string;
  manPower: number;
  jamDatang: string;
  jamPulang: string;
  jobId: string;
  duration: number;
  daysElapsed: number; // view -> auto harian
  status: ProgressStatus;
  projectStatus: ProjectStatus;
  pendingReason: string;
  sigmaHari: number;
  sigmaTeknisi: number;
  sigmaManDays: string; // target
  actualManDays: number; // akumulasi berjalan
  sales?: string;
};

interface CellAssignment {
  projectId: string; // UUID project
  technicianId: string; // code teknisi (1..30) atau UUID
  isSelected: boolean;
  initial?: string;
  isProjectLeader?: boolean;
}

interface NewProjectForm {
  namaProject: string;
  lokasi: string; // tambahan dari desain baru
  namaSales: string;
  namaPresales: string;
  tanggalSpkUser: string;
  tanggalTerimaPo: string;
  tanggalMulaiProject: string;
  tanggalDeadlineProject: string;
  sigmaManDays: string;
  sigmaHari: string;
  sigmaTeknisi: string;
  tipeTemplate: string; // tambahan dari desain baru
}

interface EditProjectForm {
  projectId: string; // UUID
  status: ProjectStatus;
  reason: string;
  isReadOnlyProject?: boolean;
}

/* ================== Helpers ================== */
const fmtID = (iso: string) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
};
const formatDateDDMMYYYY = (iso: string) => fmtID(iso);

const msToNextMidnight = () => {
  const now = new Date();
  // guard +2s untuk pastikan tanggal DB ikut berganti
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    2
  );
  return next.getTime() - now.getTime();
};

// Ambil isi dari berbagai bentuk respons: {data}, {projects}, {technicians}, array langsung, dll
function unwrap<T = any>(payload: any): T {
  if (!payload) return [] as unknown as T;
  if (Array.isArray(payload)) return payload as T;
  if ("data" in payload) return payload.data as T;
  if ("projects" in payload) return payload.projects as T;
  if ("technicians" in payload) return payload.technicians as T;
  if ("items" in payload) return payload.items as T;
  return payload as T;
}

function time5(v: any, def = "08:00") {
  if (!v) return def;
  const s = String(v);
  return s.length >= 5 ? s.slice(0, 5) : def;
}

const safeUUID = () =>
  typeof crypto !== "undefined" && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : Math.random().toString(36).slice(2);

const addDaysToIso = (iso: string, delta: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + delta);
  const y2 = dt.getFullYear();
  const m2 = String(dt.getMonth() + 1).padStart(2, "0");
  const d2 = String(dt.getDate()).padStart(2, "0");
  return `${y2}-${m2}-${d2}`;
};

/* ================== Komponen ================== */
export default function AssignScheduling() {
  const router = useRouter();

  // server-driving date (YYYY-MM-DD)
  const [currentDate, setCurrentDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [isSavingProject, setIsSavingProject] = useState(false);
  const [techs, setTechs] = useState<UITechnician[]>([]);
  const [projectsData, setProjectsData] = useState<UIProject[]>([]);
  const [techCodeToUuid, setTechCodeToUuid] = useState<Record<string, string>>(
    {}
  );

  // UI states
  const [assignments, setAssignments] = useState<CellAssignment[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showProjectSuccess, setShowProjectSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newProjectForm, setNewProjectForm] = useState<NewProjectForm>({
    namaProject: "",
    lokasi: "",
    namaSales: "",
    namaPresales: "",
    tanggalSpkUser: "",
    tanggalTerimaPo: "",
    tanggalMulaiProject: "",
    tanggalDeadlineProject: "",
    sigmaManDays: "",
    sigmaHari: "",
    sigmaTeknisi: "",
    tipeTemplate: "",
  });
  const [showSubFields, setShowSubFields] = useState(false);
  const [showEditProject, setShowEditProject] = useState(false);
  const [editProjectForm, setEditProjectForm] = useState<EditProjectForm>({
    projectId: "",
    status: "unassigned",
    reason: "",
    isReadOnlyProject: false,
  });

  // Validasi (desain baru)
  const [dateValidationError, setDateValidationError] = useState<string>("");
  const [tipeTemplateError, setTipeTemplateError] = useState<string>("");

  // Shortcut “Generate Laporan” (desain baru)
  const [showProjectShortcut, setShowProjectShortcut] = useState(false);
  const [shortcutPosition, setShortcutPosition] = useState({ x: 0, y: 0 });
  const [selectedProjectForShortcut, setSelectedProjectForShortcut] =
    useState<UIProject | null>(null);
  const shortcutRef = useRef<HTMLDivElement>(null);
  const lastClickTimeRef = useRef<number>(0);

  /* ---------- Load awal ---------- */
  useEffect(() => {
    (async () => {
      await Promise.all([loadTechnicians(), loadProjects()]);
      await loadAssignments(currentDate);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]); // Tambahkan currentDate sebagai dependency

  /* ---------- Scheduler: auto advance di tengah malam ---------- */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      timer = setTimeout(async () => {
        const key = `advance-done-${currentDate}`;
        if (!localStorage.getItem(key)) {
          try {
            await apiFetch("/api/cron/advance-day", {
              method: "POST",
              body: JSON.stringify({ date: currentDate }), // YYYY-MM-DD
            });
            localStorage.setItem(key, "1");
          } catch (e) {
            console.error("advance-day failed", e);
          }
        }
        const newIso = new Date().toISOString().slice(0, 10);
        setCurrentDate(newIso);
        // loadProjects akan otomatis dipanggil karena currentDate berubah
        await loadAssignments(newIso);
        schedule(); // jadwalkan malam berikutnya
      }, msToNextMidnight());
    };

    schedule();

    // Sync kalau user kembali ke tab setelah hari berganti
    const onFocus = async () => {
      const todayIso = new Date().toISOString().slice(0, 10);
      if (todayIso !== currentDate) {
        setCurrentDate(todayIso);
        // loadProjects akan otomatis dipanggil karena currentDate berubah
        await loadAssignments(todayIso);
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [currentDate]);

  /* ---------- API loaders (robust + fallback) ---------- */
  async function loadTechnicians() {
    try {
      // utama
      let res = await apiFetch<any>("/api/technicians", { cache: "no-store" });
      let rows = unwrap<any[]>(res);

      // fallback kemungkinan lain (opsional)
      if (!rows?.length) {
        try {
          res = await apiFetch<any>("/api/technicians/all", {
            cache: "no-store",
          });
          rows = unwrap<any[]>(res);
        } catch {}
      }

      const ui: UITechnician[] = rows.map((t: any) => ({
        id: String(t.code ?? t.id), // di UI pakai "code" kalau ada, fallback ke id
        name: t.name ?? t.nama ?? "Teknisi",
        initial: String(
          t.initials ?? t.initial ?? t.name?.[0] ?? "?"
        ).toUpperCase(),
      }));
      setTechs(ui);

      // mapping code -> uuid (kalau server mengirim dua-duanya)
      const mapping: Record<string, string> = {};
      for (const t of rows) {
        const code = String(t.code ?? t.id);
        const uuid = String(t.id ?? t.uuid ?? code);
        mapping[code] = uuid;
      }
      setTechCodeToUuid(mapping);
    } catch (e) {
      console.error("loadTechnicians failed:", e);
      setTechs([]);
      setTechCodeToUuid({});
    }
  }

  async function loadProjects() {
    try {
      // standar dengan parameter date untuk filter rentang waktu
      let res = await apiFetch<any>(`/api/projects?date=${currentDate}`, {
        cache: "no-store",
      });
      let rows = unwrap<any[]>(res);

      // fallback ke grid
      if (!rows?.length) {
        res = await apiFetch<any>(`/api/grid?date=${currentDate}`, {
          cache: "no-store",
        });
        const grid = unwrap<{ date?: string; projects?: any[]; data?: any[] }>(
          res
        );
        rows = unwrap<any[]>(grid);
      }

      const ui: UIProject[] = rows.map((p: any) => {
        const id = String(p.id ?? p.projectId ?? safeUUID());
        const name = p.name ?? p.nama ?? "Project";
        const sigmaTek = Number(p.sigma_teknisi ?? p.sigmaTechnicians ?? 0);
        const sigmaHari = Number(p.sigma_hari ?? p.sigmaDays ?? 0);
        const sigmaMD = Number(p.sigma_man_days ?? p.sigmaManDays ?? 0);
        const daysElap = Number(
          p.days_elapsed ??
            p.daysElapsed ??
            (typeof p.progressHari === "string"
              ? Number(p.progressHari.split("/")[0])
              : 0)
        );
        const status = (p.status ??
          p.progressStatus ??
          "ongoing") as ProgressStatus;
        const projectStatus = (p.project_status ??
          p.projectStatus ??
          "unassigned") as ProjectStatus;
        const mdCurrent = Number(
          p.actual_man_days ??
            p.actualManDays ??
            (typeof p.manDays === "string"
              ? Number(p.manDays.split("/")[0])
              : 0)
        );
        const jamDatang = time5(p.jam_datang ?? p.datangDefault, "08:00");
        const jamPulang = time5(p.jam_pulang ?? p.pulangDefault, "17:00");

        const sales: string = p.sales ?? p.sales_name ?? p.nama_sales ?? "";

        return {
          id,
          name,
          manPower: sigmaTek,
          jamDatang,
          jamPulang,
          jobId: p.job_id ?? p.code ?? "",
          duration: sigmaHari,
          daysElapsed: daysElap,
          status,
          projectStatus,
          pendingReason: p.pending_reason ?? p.pendingReason ?? "",
          sigmaHari: sigmaHari,
          sigmaTeknisi: sigmaTek,
          sigmaManDays: String(sigmaMD),
          actualManDays: mdCurrent,
          sales,
        } as UIProject;
      });

      setProjectsData(ui);
    } catch (e) {
      console.error("loadProjects failed:", e);
      setProjectsData([]);
    }
  }

  async function loadAssignments(isoDate: string) {
    try {
      // Bentuk utama: { data: Array<{ projectId, technicianCode, initial, ... }> }
      let res = await apiFetch<any>(`/api/assignments?date=${isoDate}`, {
        cache: "no-store",
      });
      let rows = unwrap<any[]>(res);

      // Fallback: derive dari /api/grid?date=... -> p.technicians
      if (!rows?.length) {
        res = await apiFetch<any>(`/api/grid?date=${isoDate}`, {
          cache: "no-store",
        });
        const grid = unwrap<{ date?: string; projects?: any[]; data?: any[] }>(
          res
        );
        const projects = unwrap<any[]>(grid);

        const derived: CellAssignment[] = [];
        for (const p of projects ?? []) {
          const pid = String(p.id ?? p.projectId ?? safeUUID());
          const technicians = p.technicians ?? [];
          for (const t of technicians) {
            derived.push({
              projectId: pid,
              technicianId: String(t.code ?? t.id),
              isSelected: true,
              initial: String(
                t.initials ?? t.initial ?? t.name?.[0] ?? ""
              ).toUpperCase(),
              isProjectLeader: Boolean(
                t.isProjectLeader ?? t.project_leader ?? false
              ),
            });
          }
        }
        setAssignments(derived);
        return;
      }

      const filteredAssignments = rows.map((r: any) => ({
        projectId: String(r.projectId ?? r.project_id),
        technicianId: String(
          r.technicianCode ??
            r.technician_code ??
            r.technicianId ??
            r.technician_id
        ),
        isSelected: Boolean(r.isSelected ?? false),
        initial: String(r.initial ?? r.initials ?? "").toUpperCase(),
        isProjectLeader: Boolean(r.isProjectLeader ?? false),
      }));

      setAssignments(filteredAssignments);
    } catch (e) {
      console.error("loadAssignments failed:", e);
      setAssignments([]);
    }
  }

  /* ---------- Helpers UI ---------- */
  const getCellAssignment = (projectId: string, technicianId: string) =>
    assignments.find(
      (a) => a.projectId === projectId && a.technicianId === technicianId
    );

  const getTechnicianTrackNumber = (technicianId: string) =>
    assignments.filter(
      (a) =>
        a.technicianId === technicianId && (a.isSelected || a.isProjectLeader)
    ).length;

  const getProjectAssignmentCount = (projectId: string) =>
    assignments.filter(
      (a) => a.projectId === projectId && (a.isSelected || a.isProjectLeader)
    ).length;

  /* ---------- Interaksi Grid ---------- */
  const handleCellClick = (projectId: string, technicianId: string) => {
    const project = projectsData.find((p) => p.id === projectId);
    if (!project) return;

    // Block pending & completed
    if (project.projectStatus === "pending") return;
    if (project.status === "completed") return;

    const technician = techs.find((t) => t.id === technicianId);
    if (!technician) return;

    // Cek apakah teknisi sudah di-assign ke project lain yang sedang ongoing
    const technicianOtherAssignments = assignments.filter(
      (a) =>
        a.technicianId === technicianId &&
        a.projectId !== projectId &&
        (a.isSelected || a.isProjectLeader)
    );

    if (technicianOtherAssignments.length > 0) {
      const otherProject = projectsData.find(
        (p) =>
          technicianOtherAssignments.some((a) => a.projectId === p.id) &&
          p.status === "ongoing" &&
          p.projectStatus === "ongoing"
      );
      if (otherProject) {
        alert(
          `Teknisi ${technician.name} sedang bekerja di project ${otherProject.name} dan tidak dapat dipindahkan sampai project tersebut selesai.`
        );
        return;
      }
    }

    setAssignments((prev) => {
      const existingIndex = prev.findIndex(
        (a) => a.projectId === projectId && a.technicianId === technicianId
      );
      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        if (existing.isSelected) {
          // Jika project leader, tidak bisa dihapus dengan single click
          if (existing.isProjectLeader) {
            return prev; // Tidak ada perubahan
          }

          // Hapus assignment dari array
          const updated = prev.filter((_, index) => index !== existingIndex);

          // Jika tidak ada assignment lain, set unassigned
          const remainingProjectAssignments = updated.filter(
            (a) =>
              a.projectId === projectId && (a.isSelected || a.isProjectLeader)
          );
          if (remainingProjectAssignments.length === 0) {
            setProjectsData((prevProjects) =>
              prevProjects.map((p) =>
                p.id === projectId ? { ...p, projectStatus: "unassigned" } : p
              )
            );
          }
          return updated;
        } else {
          // toggle ke selected, pertahankan leader
          const updated = [...prev];
          updated[existingIndex] = {
            ...existing,
            isSelected: true,
            initial: technician.initial,
            isProjectLeader: existing.isProjectLeader || false,
          };

          const projectAssignments = updated.filter(
            (a) =>
              a.projectId === projectId && (a.isSelected || a.isProjectLeader)
          );
          if (projectAssignments.length === 1) {
            setProjectsData((prevProjects) =>
              prevProjects.map((p) =>
                p.id === projectId && p.projectStatus === "unassigned"
                  ? { ...p, projectStatus: "ongoing" }
                  : p
              )
            );
          }
          return updated;
        }
      } else {
        // Buat assignment baru
        const existingAssignments = prev.filter(
          (a) =>
            a.projectId === projectId && (a.isSelected || a.isProjectLeader)
        );
        if (existingAssignments.length === 0) {
          setProjectsData((prevProjects) =>
            prevProjects.map((p) =>
              p.id === projectId && p.projectStatus === "unassigned"
                ? { ...p, projectStatus: "ongoing" }
                : p
            )
          );
        }
        return [
          ...prev,
          {
            projectId,
            technicianId,
            isSelected: true,
            initial: technician.initial,
            isProjectLeader: false,
          },
        ];
      }
    });
  };

  const handleCellDoubleClick = (projectId: string, technicianId: string) => {
    const project = projectsData.find((p) => p.id === projectId);
    if (!project) return;

    // Block pending & completed
    if (project.projectStatus === "pending") return;
    if (project.status === "completed") return;

    const technician = techs.find((t) => t.id === technicianId);
    if (!technician) return;

    setAssignments((prev) => {
      const existingIndex = prev.findIndex(
        (a) => a.projectId === projectId && a.technicianId === technicianId
      );
      if (existingIndex >= 0) {
        const updated = [...prev];
        const current = updated[existingIndex];

        // Toggle leader
        const newLeaderStatus = !current.isProjectLeader;

        updated[existingIndex] = {
          ...current,
          isSelected: newLeaderStatus ? true : current.isSelected,
          isProjectLeader: newLeaderStatus,
          initial: technician.initial,
        };

        // Pastikan hanya 1 leader
        if (newLeaderStatus) {
          for (let i = 0; i < updated.length; i++) {
            if (i !== existingIndex && updated[i].projectId === projectId) {
              updated[i] = { ...updated[i], isProjectLeader: false };
            }
          }
        }
        return updated;
      } else {
        // buat langsung sebagai leader
        const updated = [...prev];
        for (let i = 0; i < updated.length; i++) {
          if (updated[i].projectId === projectId) {
            updated[i] = { ...updated[i], isProjectLeader: false };
          }
        }
        return [
          ...updated,
          {
            projectId,
            technicianId,
            isSelected: true,
            isProjectLeader: true,
            initial: technician.initial,
          },
        ];
      }
    });
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      const allAssignments: CellAssignment[] = [];
      projectsData.forEach((project) => {
        // lewati baris yang tidak bisa diubah (pending/completed)
        const locked =
          project.projectStatus === "pending" || project.status === "completed";
        techs.forEach((technician) => {
          const existingAssignment = assignments.find(
            (a) =>
              a.projectId === project.id && a.technicianId === technician.id
          );
          allAssignments.push({
            projectId: project.id,
            technicianId: technician.id,
            isSelected: locked ? Boolean(existingAssignment?.isSelected) : true,
            initial: technician.initial,
            isProjectLeader: existingAssignment?.isProjectLeader || false,
          });
        });
      });
      setAssignments(allAssignments);
    } else {
      // hanya simpan leader
      setAssignments((prev) => prev.filter((a) => a.isProjectLeader));
    }
  };

  /* ---------- Navigasi tanggal (desain baru) ---------- */
  const handleDateNavigation = async (direction: "prev" | "next") => {
    const newIso = addDaysToIso(currentDate, direction === "prev" ? -1 : 1);
    setCurrentDate(newIso);
    // loadProjects akan otomatis dipanggil karena currentDate berubah
    await loadAssignments(newIso);
  };

  /* ---------- Pemanggilan API ---------- */
  const handleSaveAssignment = async () => {
    const projectIds = projectsData.map((p) => p.id);
    const payload = {
      date: currentDate,
      projectIds,
      assignments: assignments
        .filter((a) => a.isSelected || a.isProjectLeader)
        .map((a) => {
          const techUuid = techCodeToUuid[a.technicianId] ?? a.technicianId;
          const projectUuid = a.projectId;
          if (!techUuid || !projectUuid) return null;
          return {
            projectId: projectUuid,
            technicianId: techUuid,
            isSelected: a.isSelected,
            isProjectLeader: !!a.isProjectLeader,
          };
        })
        .filter(Boolean),
    };

    try {
      setLoading(true);
      await apiFetch<{ data: any }>("/api/assignments", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await Promise.all([loadProjects(), loadAssignments(currentDate)]);
      setShowConfirmation(true);
    } catch (e: any) {
      alert(e?.message || "Gagal menyimpan assignment");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    // Validasi ekstra dari desain baru
    if (
      !newProjectForm.namaProject ||
      !newProjectForm.tanggalMulaiProject ||
      !newProjectForm.tanggalDeadlineProject ||
      !newProjectForm.sigmaManDays ||
      !newProjectForm.sigmaHari ||
      !newProjectForm.sigmaTeknisi
    ) {
      return;
    }
    if (!newProjectForm.tipeTemplate) {
      setTipeTemplateError("Harap pilih tipe template");
      return;
    }
    if (
      !validateDates(
        newProjectForm.tanggalMulaiProject,
        newProjectForm.tanggalDeadlineProject
      )
    ) {
      return;
    }
    setTipeTemplateError("");

    try {
      setIsSavingProject(true);

      const payload = {
        namaProject: newProjectForm.namaProject || null,
        lokasi: newProjectForm.lokasi || null,
        namaSales: newProjectForm.namaSales || null,
        namaPresales: newProjectForm.namaPresales || null,
        tanggalSpkUser: newProjectForm.tanggalSpkUser || null,
        tanggalTerimaPo: newProjectForm.tanggalTerimaPo || null,
        tanggalMulaiProject: newProjectForm.tanggalMulaiProject,
        tanggalDeadlineProject: newProjectForm.tanggalDeadlineProject,
        sigmaManDays: Number(newProjectForm.sigmaManDays),
        sigmaHari: Number(newProjectForm.sigmaHari),
        sigmaTeknisi: Number(newProjectForm.sigmaTeknisi),
        templateKey: newProjectForm.tipeTemplate,
      };

      const res = await apiFetch<{ data: DbProjectWithStats }>(
        "/api/projects",
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      const p = (res as any).data ?? res;
      const uiProject: UIProject = {
        id: p.id,
        name: p.name,
        manPower: p.sigma_teknisi ?? 0,
        jamDatang: p.jam_datang ? String(p.jam_datang).slice(0, 5) : "08:00",
        jamPulang: p.jam_pulang ? String(p.jam_pulang).slice(0, 5) : "17:00",
        jobId: p.job_id,
        duration: p.sigma_hari ?? 0,
        daysElapsed: p.days_elapsed ?? 0,
        status: p.status,
        projectStatus: p.project_status,
        pendingReason: p.pending_reason ?? "",
        sigmaHari: p.sigma_hari ?? 0,
        sigmaTeknisi: p.sigma_teknisi ?? 0,
        sigmaManDays: String(p.sigma_man_days ?? 0),
        actualManDays: p.actual_man_days ?? 0,
        sales: p.sales ?? p.sales_name ?? p.nama_sales ?? "",
      };

      setProjectsData((prev) => [uiProject, ...prev]);
      setShowCreateProject(false);
      setShowProjectSuccess(true);
      setNewProjectForm({
        namaProject: "",
        lokasi: "",
        namaSales: "",
        namaPresales: "",
        tanggalSpkUser: "",
        tanggalTerimaPo: "",
        tanggalMulaiProject: "",
        tanggalDeadlineProject: "",
        sigmaManDays: "",
        sigmaHari: "",
        sigmaTeknisi: "",
        tipeTemplate: "",
      });
      setShowSubFields(false);
      setDateValidationError("");
      setTipeTemplateError("");
    } catch (err: any) {
      console.error(err);
      alert(err?.message || "Gagal membuat project");
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleEditProject = async () => {
    if (!editProjectForm.projectId || !editProjectForm.status) return;
    if (
      editProjectForm.status === "pending" &&
      editProjectForm.reason.trim().length < 5
    )
      return;

    try {
      setLoading(true);
      await apiFetch<{ data: any }>("/api/projects/status", {
        method: "PATCH",
        body: JSON.stringify({
          projectId: editProjectForm.projectId,
          status: editProjectForm.status,
          reason:
            editProjectForm.status === "pending"
              ? editProjectForm.reason
              : undefined,
        }),
      });
      await loadProjects();
    } catch (e: any) {
      alert(e?.message || "Gagal update status project");
    } finally {
      setLoading(false);
      setShowEditProject(false);
      setEditProjectForm({
        projectId: "",
        status: "unassigned",
        reason: "",
        isReadOnlyProject: false,
      });
    }
  };

  /* ---------- UI helper ---------- */
  const getSelectedCount = () =>
    assignments.filter((a) => a.isSelected || a.isProjectLeader).length;
  const getTotalAssignments = () =>
    assignments.filter((a) => a.isSelected || a.isProjectLeader).length;

  // Sebelumnya hanya menganggap selected/leader. Ganti jadi:
  const getIdleTechnicians = () => {
    const assignedTechnicianIds = new Set(
      assignments.map((a) => a.technicianId)
    ); // semua membership aktif
    return techs.filter((tech) => !assignedTechnicianIds.has(tech.id));
  };

  const getTechnicianStatus = (technicianId: string) => {
    const techAssignments = assignments.filter(
      (a) => a.technicianId === technicianId
    );

    if (techAssignments.length === 0) {
      return { status: "idle", color: "bg-gray-300 text-gray-700" };
    }

    // Hadir hari ini (selected) atau leader -> working
    const isWorkingToday = techAssignments.some(
      (a) => a.isSelected || a.isProjectLeader
    );
    if (isWorkingToday) {
      return { status: "working", color: "bg-blue-200 text-blue-900" };
    }

    // Member proyek aktif tapi tidak hadir -> assigned (tetap menempel)
    return { status: "assigned", color: "bg-green-200 text-green-900" };
  };

  const getProgressStatus = (project: UIProject) => {
    const sigmaHari = Number(project.sigmaHari || 0);
    const currentDays = Number(project.daysElapsed || 0);

    // anggap pending jika projectStatus = 'pending' atau ada pendingReason
    const isPending =
      project.projectStatus === "pending" || !!project.pendingReason;

    if (isPending) {
      return {
        bgColor: "bg-yellow-100",
        textColor: "text-yellow-700",
        display: `${currentDays}/${sigmaHari}`,
      };
    }

    switch (project.status) {
      case "completed":
        return {
          bgColor: "bg-green-100",
          textColor: "text-green-700",
          display: `${currentDays}/${sigmaHari}`,
        };
      case "overdue":
        return {
          bgColor: "bg-red-100",
          textColor: "text-red-700",
          display: `${currentDays}/${sigmaHari}`,
        };
      case "ongoing":
      default:
        return {
          bgColor: "bg-gray-100",
          textColor: "text-gray-700",
          display: `${currentDays}/${sigmaHari}`,
        };
    }
  };

  // Man Days berbasis AKUMULASI (actualManDays)
  const getManDaysDisplay = (project: UIProject) => {
    const current = Number(project.actualManDays || 0);
    const target = Number.parseInt(project.sigmaManDays) || 0;
    return { current, target, display: `${current}/${target}` };
  };

  const getManDaysStatus = (project: UIProject) => {
    const current = Number(project.actualManDays || 0);
    const target = Number.parseInt(project.sigmaManDays) || 0;
    let bgColor = "bg-gray-100";
    let textColor = "text-gray-700";

    if (target > 0 && current >= target && current <= target * 1.2) {
      bgColor = "bg-green-100";
      textColor = "text-green-700";
    } else if (target > 0 && current > target * 1.2) {
      bgColor = "bg-red-100";
      textColor = "text-red-700";
    }
    return { bgColor, textColor };
  };

  const getSigmaDisplay = (project: UIProject) => {
    const assignedTechnicians = getProjectAssignmentCount(project.id); // HARI INI
    const sigmaTeknisi = project.sigmaTeknisi ?? 0;
    const isOver = assignedTechnicians > sigmaTeknisi;
    return {
      current: assignedTechnicians,
      target: sigmaTeknisi,
      display: `${assignedTechnicians}/${sigmaTeknisi}`,
      className: isOver ? "text-red-600 font-semibold" : "text-gray-900",
    };
  };

  const getProjectStatusDisplay = (project: UIProject) => {
    const { projectStatus, pendingReason } = project;

    let bgColor = "bg-gray-100";
    let textColor = "text-gray-700";
    let label = "Belum Diassign";

    switch (projectStatus) {
      case "ongoing":
        bgColor = "bg-green-100";
        textColor = "text-green-700";
        label = "Berlangsung";
        break;
      case "pending":
        bgColor = "bg-yellow-100";
        textColor = "text-yellow-700";
        label = "Pending";
        break;
      case "unassigned":
        bgColor = "bg-gray-100";
        textColor = "text-gray-700";
        label = "Belum Diassign";
        break;
    }
    return { bgColor, textColor, label, reason: pendingReason };
  };

  const truncateText = (text: string, maxLength = 20) =>
    text.length <= maxLength ? text : text.substring(0, maxLength) + "...";

  const handleStatusDoubleClick = (project: UIProject) => {
    setEditProjectForm({
      projectId: project.id,
      status: project.projectStatus,
      reason: project.pendingReason || "",
      isReadOnlyProject: true,
    });
    setShowEditProject(true);
  };

  /* ---------- Shortcut “Generate Laporan” (desain baru) ---------- */
  const downloadDocx = (jobId: string) => {
    const url = `/api/laporan/docx?jobId=${encodeURIComponent(jobId)}`;
    window.open(url, "_blank");
  };

  const handleProjectNameRightClick = (
    event: React.MouseEvent,
    project: UIProject
  ) => {
    event.preventDefault();
    const now = Date.now();
    if (now - lastClickTimeRef.current < 300) return;
    lastClickTimeRef.current = now;
    if (!project?.id) return;

    const rect = (event.target as HTMLElement).getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = rect.left + rect.width / 2;
    let y = rect.bottom + 8;
    if (x + 150 > viewportWidth) x = rect.left - 150;
    if (y + 60 > viewportHeight) y = rect.top - 60;

    setShortcutPosition({ x, y });
    setSelectedProjectForShortcut(project);
    setShowProjectShortcut(true);
  };

  const handleGenerateLaporan = () => {
    if (selectedProjectForShortcut?.jobId) {
      downloadDocx(selectedProjectForShortcut.jobId);
    } else {
      alert("Job ID tidak ditemukan untuk project ini.");
    }
    setShowProjectShortcut(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        shortcutRef.current &&
        !shortcutRef.current.contains(event.target as Node)
      ) {
        setShowProjectShortcut(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowProjectShortcut(false);
      else if (event.key === "Enter" && showProjectShortcut)
        handleGenerateLaporan();
    };
    if (showProjectShortcut) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      setTimeout(() => shortcutRef.current?.focus(), 0);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showProjectShortcut]);

  /* ---------- Validasi tanggal (desain baru) ---------- */
  const validateDates = (startDate: string, deadlineDate: string) => {
    if (startDate && deadlineDate) {
      const start = new Date(startDate);
      const deadline = new Date(deadlineDate);
      if (deadline < start) {
        setDateValidationError(
          "Tanggal deadline harus sama atau setelah tanggal mulai project"
        );
        return false;
      }
    }
    setDateValidationError("");
    return true;
  };

  type TemplateOption = { value: string; label: string };

  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/report-templates", { cache: "no-store" });
        const json = await res.json();
        setTemplateOptions(json.items ?? []);
      } catch {
        setTemplateOptions([]);
      }
    })();
  }, []);

  /* ---------- Render ---------- */
  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Assign Penjadwalan Teknisi"
        showBackButton={true}
        backUrl="/admin/dashboard"
        rightContent={
          <Button
            onClick={handleSaveAssignment}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2"
            disabled={loading || getSelectedCount() === 0}
          >
            {loading
              ? "Menyimpan..."
              : `Simpan Assignment (${getSelectedCount()})`}
          </Button>
        }
      />

      <main className="p-4">
        <div className="max-w-full mx-auto">
          <div className="mb-4 flex items-center justify-between bg-white p-3 rounded-lg shadow-sm">
            <div className="flex items-center gap-3">
              <Checkbox
                id="select-all"
                checked={selectAll}
                onCheckedChange={(v) => handleSelectAll(Boolean(v))}
                className="h-4 w-4"
              />
              <label
                htmlFor="select-all"
                className="text-sm font-medium cursor-pointer"
              >
                Select All Projects & Technicians
              </label>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setShowEditProject(true)}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 text-sm"
              >
                <Edit className="h-4 w-4 mr-2" />
                Edit Project
              </Button>
              <Button
                onClick={() => setShowCreateProject(true)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-sm"
              >
                <Plus className="h-4 w-4 mr-2" />
                Buat Project
              </Button>

              {/* Navigasi tanggal ala desain baru */}
              <div className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-lg">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDateNavigation("prev")}
                  className="h-8 w-8 p-0 hover:bg-gray-200"
                  aria-label="Sebelumnya"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2 px-2">
                  <Calendar className="h-4 w-4 text-gray-600" />
                  <span className="text-sm font-medium text-gray-700 min-w-[96px] text-center">
                    {formatDateDDMMYYYY(currentDate)}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDateNavigation("next")}
                  className="h-8 w-8 p-0 hover:bg-gray-200"
                  aria-label="Berikutnya"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-gray-900 border-r border-gray-300 w-28">
                      Nama Proyek
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-900 border-r border-gray-300 w-10">
                      <div className="flex flex-col items-center justify-end h-full">
                        <div className="text-lg font-bold mb-2">Σ</div>
                        <div className="text-xs font-bold bg-gray-200 rounded px-1 min-w-[18px] text-center">
                          {getTotalAssignments()}
                        </div>
                      </div>
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-900 border-r border-gray-300 w-16">
                      Man Days
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-900 border-r border-gray-300 w-16">
                      Progress (Hari)
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-900 border-r border-gray-300 w-14">
                      Datang
                    </th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-900 border-r border-gray-300 w-14">
                      Pulang
                    </th>
                    {techs.map((technician) => (
                      <th
                        key={technician.id}
                        className="px-1 py-4 text-center font-semibold text-gray-900 border-r border-gray-300 w-6 sticky top-0 bg-gray-100 h-32"
                        title={technician.name}
                      >
                        <div className="flex flex-col items-center justify-end h-full">
                          <div
                            className="text-xs font-bold whitespace-nowrap mb-2"
                            style={{
                              writingMode: "vertical-lr",
                              textOrientation: "mixed",
                              transform: "rotate(180deg)",
                              height: "70px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {technician.name}
                          </div>
                          <div className="text-xs font-bold bg-gray-200 rounded px-1 min-w-[18px] text-center">
                            {getTechnicianTrackNumber(technician.id)}
                          </div>
                        </div>
                      </th>
                    ))}
                    <th className="px-1 py-2 text-center font-semibold text-gray-900 border-r border-gray-300 w-20">
                      Status
                    </th>
                    <th className="px-1 py-2 text-center font-semibold text-gray-900 border-r border-gray-300 w-20">
                      Sales
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {projectsData.map((project, projectIndex) => {
                    const rowBgColor =
                      projectIndex % 2 === 0 ? "bg-white" : "bg-gray-50";
                    const progressStatus = getProgressStatus(project);
                    const sigmaDisplay = getSigmaDisplay(project);
                    const manDaysDisplay = getManDaysDisplay(project);
                    const manDaysStatus = getManDaysStatus(project);
                    const projectStatusDisplay =
                      getProjectStatusDisplay(project);

                    const isLockedRow =
                      project.projectStatus === "pending" ||
                      project.status === "completed";

                    return (
                      <tr key={project.id} className={rowBgColor}>
                        <td
                          className={`px-1 py-1 border-r border-gray-200 font-medium ${rowBgColor}`}
                        >
                          <div
                          
                            className="text-xs font-semibold cursor-pointer hover:bg-blue-50 px-1 py-1 rounded transition-colors"
                            onContextMenu={(e) =>
                              handleProjectNameRightClick(e, project)
                            }
                            title={
                              project.jobId
                                ? "Klik kanan untuk shortcut Generate Laporan (DOCX)"
                                : "Job ID belum tersedia"
                            }
                          >
                            {project.name}
                          </div>
                          <div className="text-[9px] text-gray-500 leading-tight">
                            {project.jobId}
                          </div>
                        </td>

                        <td
                          className={`px-2 py-1 text-center border-r border-gray-200 font-semibold ${rowBgColor}`}
                        >
                          <div
                            className={`text-xs font-bold ${sigmaDisplay.className}`}
                          >
                            {sigmaDisplay.display}
                          </div>
                        </td>

                        <td
                          className={`px-2 py-1 text-center border-r border-gray-200 ${rowBgColor}`}
                        >
                          <div
                            className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium ${manDaysStatus.bgColor} ${manDaysStatus.textColor}`}
                          >
                            <span>{manDaysDisplay.display}</span>
                          </div>
                        </td>

                        <td
                          className={`px-2 py-1 text-center border-r border-gray-200 ${rowBgColor}`}
                        >
                          <div
                            className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium ${progressStatus.bgColor} ${progressStatus.textColor}`}
                          >
                            <span>{progressStatus.display}</span>
                          </div>
                        </td>

                        <td
                          className={`px-2 py-1 text-center border-r border-gray-200 text-xs ${rowBgColor}`}
                        >
                          {project.jamDatang}
                        </td>
                        <td
                          className={`px-2 py-1 text-center border-r border-gray-200 text-xs ${rowBgColor}`}
                        >
                          {project.jamPulang}
                        </td>

                        {techs.map((technician) => {
                          const assignment = getCellAssignment(
                            project.id,
                            technician.id
                          );
                          const isSelected = assignment?.isSelected === true;
                          const isProjectLeader =
                            assignment?.isProjectLeader === true;

                          let cellBgColor = rowBgColor;
                          let textColor = "text-gray-900";
                          let displayInitial = "";

                          // Project leader selalu ditampilkan (merah), walau tidak selected
                          if (isProjectLeader) {
                            cellBgColor = "bg-red-500";
                            textColor = "text-white";
                            displayInitial =
                              assignment?.initial || technician.initial;
                          } else if (isSelected) {
                            // Hanya highlight biru jika hadir (selected)
                            cellBgColor = "bg-blue-200";
                            textColor = "text-blue-900";
                            displayInitial =
                              assignment?.initial || technician.initial;
                          }
                          // NOTE: jika ada membership tapi isSelected=false -> biarkan seperti sel kosong (rowBgColor)

                          const disabledCell =
                            project.projectStatus === "pending" ||
                            project.status === "completed";

                          return (
                            <td
                              key={`${project.id}-${technician.id}`}
                              className={`px-1 py-1 text-center border-r border-gray-200 ${
                                disabledCell
                                  ? "cursor-not-allowed opacity-60"
                                  : "cursor-pointer hover:bg-blue-100"
                              } transition-colors ${cellBgColor}`}
                              onClick={() =>
                                !disabledCell &&
                                handleCellClick(project.id, technician.id)
                              }
                              onDoubleClick={() =>
                                !disabledCell &&
                                handleCellDoubleClick(project.id, technician.id)
                              }
                              title={
                                disabledCell
                                  ? project.projectStatus === "pending"
                                    ? "Proyek sedang pending"
                                    : "Proyek telah selesai"
                                  : isProjectLeader
                                  ? `${technician.name} (Project Leader) - Double click to remove leader status`
                                  : isSelected
                                  ? `${technician.name} (Assigned) - Single click: toggle attendance | Double click: set as leader`
                                  : `Single click: assign ${technician.name} | Double click: set as project leader`
                              }
                            >
                              <div
                                className={`h-4 w-4 mx-auto flex items-center justify-center rounded font-bold text-xs ${textColor}`}
                              >
                                {displayInitial}
                              </div>
                            </td>
                          );
                        })}

                        <td
                          className={`px-1 py-1 text-center border-r border-gray-200 ${rowBgColor}`}
                        >
                          <div
                            className={`px-2 py-1 rounded text-xs font-medium cursor-pointer hover:opacity-80 transition-opacity ${projectStatusDisplay.bgColor} ${projectStatusDisplay.textColor}`}
                            title={
                              project.projectStatus === "pending" &&
                              project.pendingReason
                                ? project.pendingReason
                                : projectStatusDisplay.label
                            }
                            onDoubleClick={() =>
                              handleStatusDoubleClick(project)
                            }
                          >
                            {project.projectStatus === "pending" &&
                            project.pendingReason
                              ? truncateText(project.pendingReason)
                              : projectStatusDisplay.label}
                          </div>
                        </td>
                        <td
                          className={`px-1 py-1 text-center border-r border-gray-200 ${rowBgColor}`}
                        >
                          <div className="px-2 py-1 text-xs font-medium text-gray-700">
                            {project.sales
                              ? truncateText(project.sales, 25)
                              : "-"}
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {/* Hanya tampilkan baris teknisi idle jika ada teknisi yang idle */}
                  {getIdleTechnicians().length > 0 && (
                    <tr className="bg-blue-50 border-t-2 border-blue-200">
                      <td className="px-1 py-1 border-r border-gray-200 font-medium bg-blue-50">
                        <div className="text-xs font-semibold">Di Kantor</div>
                        <div className="text-[9px] text-gray-500 leading-tight">
                          Teknisi Idle
                        </div>
                      </td>

                      <td className="px-2 py-1 text-center border-r border-gray-200 font-semibold bg-blue-50">
                        <div className="text-xs font-bold">
                          {getIdleTechnicians().length}
                        </div>
                      </td>

                      <td className="px-2 py-1 text-center border-r border-gray-200 bg-blue-50">
                        <div className="inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          <span>-</span>
                        </div>
                      </td>

                      <td className="px-2 py-1 text-center border-r border-gray-200 bg-blue-50">
                        <div className="inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          <span>-</span>
                        </div>
                      </td>

                      <td className="px-2 py-1 text-center border-r border-gray-200 text-xs bg-blue-50">
                        -
                      </td>
                      <td className="px-2 py-1 text-center border-r border-gray-200 text-xs bg-blue-50">
                        -
                      </td>

                      {techs.map((technician) => {
                        const techStatus = getTechnicianStatus(technician.id);
                        const isIdle = techStatus.status === "idle";

                        return (
                          <td
                            key={`idle-${technician.id}`}
                            className="px-1 py-1 text-center border-r border-gray-200 bg-blue-50"
                          >
                            <div
                              className={`h-4 w-4 mx-auto flex items-center justify-center rounded font-bold text-xs ${
                                isIdle ? "text-gray-700" : ""
                              }`}
                            >
                              {isIdle ? technician.initial : ""}
                            </div>
                          </td>
                        );
                      })}

                      <td className="px-1 py-1 text-center border-r border-gray-200 bg-blue-50"></td>
                      <td className="px-1 py-1 text-center border-r border-gray-200 bg-blue-50"></td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 bg-white p-3 rounded-lg shadow-sm">
            <h3 className="text-sm font-semibold mb-2">Assignment Summary</h3>
            <p className="text-xs text-gray-600">
              Total assignments selected:{" "}
              <span className="font-bold text-blue-600">
                {getSelectedCount()}
              </span>
            </p>
          </div>
        </div>
      </main>

      {/* Project Shortcut Popup */}
      {showProjectShortcut && (
        <div
          ref={shortcutRef}
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-2 focus:outline-none"
          style={{
            left: `${shortcutPosition.x}px`,
            top: `${shortcutPosition.y}px`,
            minWidth: "150px",
          }}
          tabIndex={-1}
        >
          <Button
            onClick={handleGenerateLaporan}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs py-2 px-3"
            autoFocus
            disabled={!selectedProjectForShortcut?.jobId}
            title={
              selectedProjectForShortcut?.jobId
                ? `Generate Laporan DOCX untuk Job ${selectedProjectForShortcut.jobId}`
                : "Job ID tidak tersedia"
            }
          >
            Generate Laporan
          </Button>
        </div>
      )}

      {/* Edit Project */}
      <Dialog open={showEditProject} onOpenChange={setShowEditProject}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label
                htmlFor="project-select"
                className="flex items-center gap-1"
              >
                Nama Project<span className="text-red-500">*</span>
              </Label>
              <Select
                value={editProjectForm.projectId}
                onValueChange={(value) =>
                  setEditProjectForm((prev) => ({ ...prev, projectId: value }))
                }
                disabled={editProjectForm.isReadOnlyProject}
              >
                <SelectTrigger
                  className={
                    editProjectForm.isReadOnlyProject ? "bg-gray-100" : ""
                  }
                >
                  <SelectValue placeholder="Pilih project yang akan diedit" />
                </SelectTrigger>
                <SelectContent>
                  {projectsData.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editProjectForm.isReadOnlyProject && (
                <div className="text-xs text-gray-500">
                  Project dipilih otomatis. Gunakan tombol "Edit Project" di
                  header untuk mengganti project.
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label
                htmlFor="status-select"
                className="flex items-center gap-1"
              >
                Ganti Status<span className="text-red-500">*</span>
              </Label>
              <Select
                value={editProjectForm.status}
                onValueChange={(value: ProjectStatus) =>
                  setEditProjectForm((prev) => ({ ...prev, status: value }))
                }
              >
                <SelectTrigger autoFocus={editProjectForm.isReadOnlyProject}>
                  <SelectValue placeholder="Pilih status baru" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">
                    Belum Diassign (Abu-abu)
                  </SelectItem>
                  <SelectItem value="ongoing">Berlangsung (Hijau)</SelectItem>
                  <SelectItem value="pending">Pending (Kuning)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editProjectForm.status === "pending" && (
              <div className="grid gap-2">
                <Label
                  htmlFor="pending-reason"
                  className="flex items-center gap-1"
                >
                  Alasan Pending<span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="pending-reason"
                  value={editProjectForm.reason}
                  onChange={(e) =>
                    setEditProjectForm((prev) => ({
                      ...prev,
                      reason: e.target.value,
                    }))
                  }
                  placeholder="Masukkan alasan mengapa project di-pending..."
                  className="min-h-[80px] resize-none"
                  maxLength={300}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setShowEditProject(false);
                    if (e.key === "Enter" && e.ctrlKey) handleEditProject();
                  }}
                />
                <div className="text-xs text-gray-500 text-right">
                  {editProjectForm.reason.length}/300 karakter
                </div>
                {editProjectForm.reason.trim().length < 5 &&
                  editProjectForm.reason.length > 0 && (
                    <div className="text-xs text-red-500">
                      Alasan minimal 5 karakter
                    </div>
                  )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowEditProject(false);
                setEditProjectForm({
                  projectId: "",
                  status: "unassigned",
                  reason: "",
                  isReadOnlyProject: false,
                });
              }}
            >
              Batal
            </Button>
            <Button
              onClick={handleEditProject}
              disabled={
                !editProjectForm.projectId ||
                !editProjectForm.status ||
                (editProjectForm.status === "pending" &&
                  editProjectForm.reason.trim().length < 5) ||
                loading
              }
              className="bg-orange-600 hover:bg-orange-700"
            >
              {loading ? "Menyimpan..." : "Simpan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Project (desain baru, payload tetap API lama) */}
      <Dialog open={showCreateProject} onOpenChange={setShowCreateProject}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <DialogTitle>Buat Project Baru</DialogTitle>
              <div className="flex flex-col items-end gap-2 mr-6">
                <Button
                  onClick={handleCreateProject}
                  disabled={
                    isSavingProject ||
                    !newProjectForm.namaProject ||
                    !newProjectForm.tanggalMulaiProject ||
                    !newProjectForm.tanggalDeadlineProject ||
                    !newProjectForm.sigmaManDays ||
                    !newProjectForm.sigmaHari ||
                    !newProjectForm.sigmaTeknisi ||
                    !newProjectForm.tipeTemplate ||
                    !!dateValidationError
                  }
                  className="bg-green-600 hover:bg-green-700"
                  size="sm"
                >
                  {isSavingProject ? "Menyimpan..." : "Buat Project"}
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <Label
                htmlFor="namaProject"
                className="flex items-center gap-1 min-w-[140px] md:min-w-[140px]"
              >
                Nama Project<span className="text-red-500">*</span>
              </Label>
              <div className="flex-1">
                <input
                  id="namaProject"
                  type="text"
                  value={newProjectForm.namaProject}
                  onChange={(e) =>
                    setNewProjectForm((prev) => ({
                      ...prev,
                      namaProject: e.target.value,
                    }))
                  }
                  onClick={() => setShowSubFields(true)}
                  placeholder="Format: NamaBarang_NamaInstansi_Lokasi"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center gap-2">
              <Label
                htmlFor="lokasi"
                className="flex items-center gap-1 min-w-[140px] md:min-w-[140px]"
              >
                Lokasi
              </Label>
              <div className="flex-1">
                <input
                  id="lokasi"
                  type="text"
                  value={newProjectForm.lokasi}
                  onChange={(e) =>
                    setNewProjectForm((prev) => ({
                      ...prev,
                      lokasi: e.target.value,
                    }))
                  }
                  placeholder="Contoh: Bank Mandiri Darmo"
                  maxLength={140}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maksimal 140 karakter ({newProjectForm.lokasi.length}/140)
                </p>
              </div>
            </div>

            {showSubFields && (
              <div className="grid gap-3 p-3 bg-gray-50 rounded-md">
                <div className="grid gap-2">
                  <Label htmlFor="namaSales">Nama Sales</Label>
                  <input
                    id="namaSales"
                    type="text"
                    value={newProjectForm.namaSales}
                    onChange={(e) =>
                      setNewProjectForm((prev) => ({
                        ...prev,
                        namaSales: e.target.value,
                      }))
                    }
                    placeholder="Masukkan nama sales"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="namaPresales">Nama Presales</Label>
                  <input
                    id="namaPresales"
                    type="text"
                    value={newProjectForm.namaPresales}
                    onChange={(e) =>
                      setNewProjectForm((prev) => ({
                        ...prev,
                        namaPresales: e.target.value,
                      }))
                    }
                    placeholder="Masukkan nama presales"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column */}
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <Label htmlFor="tanggalSpkUser" className="min-w-[120px]">
                    Tanggal SPK User
                  </Label>
                  <input
                    id="tanggalSpkUser"
                    type="date"
                    value={newProjectForm.tanggalSpkUser}
                    onChange={(e) =>
                      setNewProjectForm((prev) => ({
                        ...prev,
                        tanggalSpkUser: e.target.value,
                      }))
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>

                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <Label
                    htmlFor="tanggalMulaiProject"
                    className="flex items-center gap-1 min-w-[120px]"
                  >
                    Tanggal Mulai Project<span className="text-red-500">*</span>
                  </Label>
                  <input
                    id="tanggalMulaiProject"
                    type="date"
                    value={newProjectForm.tanggalMulaiProject}
                    onChange={(e) => {
                      setNewProjectForm((prev) => ({
                        ...prev,
                        tanggalMulaiProject: e.target.value,
                      }));
                      validateDates(
                        e.target.value,
                        newProjectForm.tanggalDeadlineProject
                      );
                    }}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>

                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <Label
                    htmlFor="sigmaManDays"
                    className="flex items-center gap-1 min-w-[120px]"
                  >
                    Sigma Man Days<span className="text-red-500">*</span>
                  </Label>
                  <input
                    id="sigmaManDays"
                    type="number"
                    min="0"
                    value={newProjectForm.sigmaManDays}
                    onChange={(e) =>
                      setNewProjectForm((prev) => ({
                        ...prev,
                        sigmaManDays: e.target.value,
                      }))
                    }
                    placeholder="Masukkan target man days"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>

                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <Label
                    htmlFor="sigmaTeknisi"
                    className="flex items-center gap-1 min-w-[120px]"
                  >
                    Sigma Teknisi<span className="text-red-500">*</span>
                  </Label>
                  <input
                    id="sigmaTeknisi"
                    type="number"
                    min="0"
                    value={newProjectForm.sigmaTeknisi}
                    onChange={(e) =>
                      setNewProjectForm((prev) => ({
                        ...prev,
                        sigmaTeknisi: e.target.value,
                      }))
                    }
                    placeholder="Masukkan jumlah teknisi"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <Label htmlFor="tanggalTerimaPo" className="min-w-[120px]">
                    Tanggal Terima PO
                  </Label>
                  <input
                    id="tanggalTerimaPo"
                    type="date"
                    value={newProjectForm.tanggalTerimaPo}
                    onChange={(e) =>
                      setNewProjectForm((prev) => ({
                        ...prev,
                        tanggalTerimaPo: e.target.value,
                      }))
                    }
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>

                <div className="flex flex-col md:flex-row md:items-start gap-2">
                  <Label
                    htmlFor="tanggalDeadlineProject"
                    className="flex items-center gap-1 min-w-[120px] md:mt-2"
                  >
                    Tanggal Deadline Project
                    <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex-1">
                    <input
                      id="tanggalDeadlineProject"
                      type="date"
                      value={newProjectForm.tanggalDeadlineProject}
                      onChange={(e) => {
                        setNewProjectForm((prev) => ({
                          ...prev,
                          tanggalDeadlineProject: e.target.value,
                        }));
                        validateDates(
                          newProjectForm.tanggalMulaiProject,
                          e.target.value
                        );
                      }}
                      className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${
                        dateValidationError ? "border-red-500" : "border-input"
                      }`}
                      required
                    />
                    {dateValidationError && (
                      <p className="text-xs text-red-500 mt-1">
                        {dateValidationError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-col md:flex-row md:items-center gap-2">
                  <Label
                    htmlFor="sigmaHari"
                    className="flex items-center gap-1 min-w-[120px]"
                  >
                    Sigma Hari<span className="text-red-500">*</span>
                  </Label>
                  <input
                    id="sigmaHari"
                    type="number"
                    min="0"
                    value={newProjectForm.sigmaHari}
                    onChange={(e) =>
                      setNewProjectForm((prev) => ({
                        ...prev,
                        sigmaHari: e.target.value,
                      }))
                    }
                    placeholder="Masukkan durasi project (hari)"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    required
                  />
                </div>

                <div className="flex flex-col md:flex-row md:items-start gap-2">
                  <Label
                    htmlFor="tipeTemplate"
                    className="flex items-center gap-1 min-w-[120px] md:mt-2"
                  >
                    Tipe Template<span className="text-red-500">*</span>
                  </Label>
                  <div className="flex-1">
                    <select
                      id="tipeTemplate"
                      value={newProjectForm.tipeTemplate}
                      onChange={(e) => {
                        setNewProjectForm((prev) => ({
                          ...prev,
                          tipeTemplate: e.target.value,
                        }));
                        if (e.target.value) setTipeTemplateError("");
                      }}
                      className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${
                        tipeTemplateError ? "border-red-500" : "border-input"
                      }`}
                      required
                    >
                      <option value="" disabled>
                        Pilih Tipe Template
                      </option>
                      {templateOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {tipeTemplateError && (
                      <p className="text-xs text-red-500 mt-1">
                        {tipeTemplateError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateProject(false);
                setNewProjectForm({
                  namaProject: "",
                  lokasi: "",
                  namaSales: "",
                  namaPresales: "",
                  tanggalSpkUser: "",
                  tanggalTerimaPo: "",
                  tanggalMulaiProject: "",
                  tanggalDeadlineProject: "",
                  sigmaManDays: "",
                  sigmaHari: "",
                  sigmaTeknisi: "",
                  tipeTemplate: "",
                });
                setShowSubFields(false);
                setDateValidationError("");
                setTipeTemplateError("");
              }}
            >
              Batal
            </Button>
            <Button
              onClick={handleCreateProject}
              disabled={
                isSavingProject ||
                !newProjectForm.namaProject ||
                !newProjectForm.tanggalMulaiProject ||
                !newProjectForm.tanggalDeadlineProject ||
                !newProjectForm.sigmaManDays ||
                !newProjectForm.sigmaHari ||
                !newProjectForm.sigmaTeknisi ||
                !newProjectForm.tipeTemplate ||
                !!dateValidationError
              }
              className="bg-green-600 hover:bg-green-700"
            >
              {isSavingProject ? "Menyimpan..." : "Buat Project"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Notifs */}
      {showProjectSuccess && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">
                Projek Baru Telah Selesai Dibuat
              </h3>
              <Button
                onClick={() => setShowProjectSuccess(false)}
                className="w-full bg-green-600 hover:bg-green-700 text-lg py-3"
              >
                OK
              </Button>
            </div>
          </div>
        </div>
      )}

      {showConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-4">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">
                Assignment Berhasil Disimpan!
              </h3>
              <p className="text-lg text-gray-600 mb-6">
                {getSelectedCount()} assignment teknisi telah berhasil disimpan
                ke sistem.
              </p>
              <Button
                onClick={() => setShowConfirmation(false)}
                className="w-full bg-green-600 hover:bg-green-700 text-lg py-3"
              >
                OK
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
