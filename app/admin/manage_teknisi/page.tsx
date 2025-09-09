"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdminHeader } from "@/components/admin-header";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";

interface Technician {
  id: string;
  code: string;
  name: string;
  initial: string;
  email: string;
  phone: string;
  status: "Di_Kantor" | "ditugaskan" | "selesai";
  joinDate: string;
}

interface Job {
  id: string;
  jobName: string;
  location: string;
  assignmentDate: string;
  technicianId: string;
  technicianName: string;
  status: "Di_Kantor" | "ditugaskan" | "selesai";
  template: string;
  notes: string;
}

// Mock data for technicians
const mockTechnicians: Technician[] = [
  {
    id: "1",
    code: "T001",
    name: "Ahmad Teknisi",
    initial: "AT",
    email: "ahmad@company.com",
    phone: "081234567890",
    status: "ditugaskan",
    joinDate: "2023-01-15",
  },
  {
    id: "2",
    code: "T002",
    name: "Budi Teknisi",
    initial: "BT",
    email: "budi@company.com",
    phone: "081234567891",
    status: "Di_Kantor",
    joinDate: "2023-02-10",
  },
  {
    id: "3",
    code: "T003",
    name: "Citra Teknisi",
    initial: "CT",
    email: "citra@company.com",
    phone: "081234567892",
    status: "selesai",
    joinDate: "2023-03-05",
  },
  {
    id: "4",
    code: "T004",
    name: "Dedi Teknisi",
    initial: "DT",
    email: "dedi@company.com",
    phone: "081234567893",
    status: "ditugaskan",
    joinDate: "2023-04-12",
  },
];

// Mock data for jobs
const mockJobs: Job[] = [
  {
    id: "JOB001",
    jobName: "Pemasangan CCTV RW 06",
    location: "Jl. Merdeka No. 123",
    assignmentDate: "2024-01-15",
    technicianId: "1",
    technicianName: "Ahmad Teknisi",
    status: "ditugaskan",
    template: "Template A",
    notes: "Pemasangan 4 unit CCTV",
  },
  {
    id: "JOB002",
    jobName: "Maintenance Server Kantor",
    location: "Gedung Perkantoran Blok A",
    assignmentDate: "2024-01-14",
    technicianId: "2",
    technicianName: "Budi Teknisi",
    status: "selesai",
    template: "Template B",
    notes: "Maintenance rutin server",
  },
  {
    id: "JOB003",
    jobName: "Instalasi Jaringan WiFi",
    location: "Komplek Perumahan Indah",
    assignmentDate: "2024-01-16",
    technicianId: "4",
    technicianName: "Dedi Teknisi",
    status: "ditugaskan",
    template: "Template C",
    notes: "Setup WiFi untuk 20 unit rumah",
  },
];

const getStatusBadge = (status: string) => {
  switch (status) {
    case "Di_Kantor":
      return (
        <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">
          Di Kantor
        </Badge>
      );
    case "ditugaskan":
      return (
        <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
          Ditugaskan
        </Badge>
      );
    case "selesai":
      return (
        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
          Selesai
        </Badge>
      );
    default:
      return (
        <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">
          Unknown
        </Badge>
      );
  }
};

export default function ManageTechnicians() {
  const [technicians, setTechnicians] = useState<Technician[]>(mockTechnicians);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [jobCurrentPage, setJobCurrentPage] = useState(1);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const itemsPerPage = 5;

  useEffect(() => {
    // Load technicians from API if needed
    // For now using mock data
    // loadTechnicians()
  }, []);

  async function loadTechnicians() {
    try {
      setLoading(true);
      const response = await apiFetch("/api/technicians");
      const data = response.data || [];
      setTechnicians(data);
    } catch (error) {
      console.error("Error loading technicians:", error);
      alert("Gagal memuat data teknisi");
    } finally {
      setLoading(false);
    }
  }

  async function deleteTechnician(
    technicianId: string,
    technicianName: string
  ) {
    if (
      !confirm(
        `Apakah Anda yakin ingin menghapus teknisi ${technicianName}? Tindakan ini tidak dapat dibatalkan.`
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      const response = await apiFetch(`/api/technicians?id=${technicianId}`, {
        method: "DELETE",
      });

      if (response.error) {
        throw new Error(response.error);
      }

      // Hapus dari state lokal
      setTechnicians((prev) => prev.filter((tech) => tech.id !== technicianId));
      alert(`Teknisi ${technicianName} berhasil dihapus`);
    } catch (error: any) {
      console.error("Error deleting technician:", error);
      alert(`Gagal menghapus teknisi: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  // Filter technicians
  const filteredTechnicians = technicians.filter((tech) => {
    const matchesSearch =
      tech.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tech.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tech.phone.includes(searchTerm);
    const matchesStatus =
      statusFilter === "all" || tech.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Filter jobs
  const filteredJobs = mockJobs.filter(
    (job) =>
      job.jobName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.technicianName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination for technicians
  const totalPages = Math.ceil(filteredTechnicians.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedTechnicians = filteredTechnicians.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  // Pagination for jobs
  const jobTotalPages = Math.ceil(filteredJobs.length / itemsPerPage);
  const jobStartIndex = (jobCurrentPage - 1) * itemsPerPage;
  const paginatedJobs = filteredJobs.slice(
    jobStartIndex,
    jobStartIndex + itemsPerPage
  );

  const handleEditJob = (job: Job) => {
    setEditingJob({ ...job });
    setIsEditModalOpen(true);
  };

  const handleSaveJob = () => {
    // In real app, this would save to database
    alert("Perubahan job berhasil disimpan!");
    setIsEditModalOpen(false);
    setEditingJob(null);
  };

  const handleDeleteJob = (id: string) => {
    if (confirm("Apakah Anda yakin ingin menghapus job ini?")) {
      alert(`Job dengan ID: ${id} telah dihapus`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Kelola Teknisi"
        showBackButton={true}
        backUrl="/admin/dashboard"
      />

      <main className="p-8">
        <div className="max-w-7xl mx-auto">
          <Tabs defaultValue="technicians" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-8">
              <TabsTrigger value="technicians" className="text-lg py-3">
                Data Teknisi
              </TabsTrigger>
              <TabsTrigger value="jobs" className="text-lg py-3">
                Daftar Pekerjaan Teknisi
              </TabsTrigger>
            </TabsList>

            {/* Tab 1: Data Teknisi */}
            <TabsContent value="technicians">
              {/* Header Actions */}
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-8">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
                  <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                    <Input
                      placeholder="Cari teknisi..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10 text-lg py-3"
                    />
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-48 text-lg py-3">
                      <SelectValue placeholder="Filter Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Status</SelectItem>
                      <SelectItem value="Di_Kantor">Di Kantor</SelectItem>
                      <SelectItem value="ditugaskan">Ditugaskan</SelectItem>
                      <SelectItem value="selesai">Selesai</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={() =>
                    alert("Fitur tambah teknisi akan segera tersedia")
                  }
                  className="bg-blue-600 hover:bg-blue-700 text-lg px-6 py-3"
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Tambah Teknisi
                </Button>
              </div>

              {/* Technicians Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">Daftar Teknisi</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Nama Teknisi
                          </th>
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Email
                          </th>
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Nomor Telepon
                          </th>
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Status Keaktifan
                          </th>
                          <th className="text-center py-4 px-4 font-semibold text-gray-700 text-lg">
                            Aksi
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedTechnicians.map((tech) => (
                          <tr
                            key={tech.id}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="py-4 px-4">
                              <div className="font-medium text-gray-900 text-lg">
                                {tech.name}
                              </div>
                              <div className="text-sm text-gray-500">
                                Bergabung: {tech.joinDate}
                              </div>
                            </td>
                            <td className="py-4 px-4 text-gray-700 text-lg">
                              {tech.email}
                            </td>
                            <td className="py-4 px-4 text-gray-700 text-lg">
                              {tech.phone}
                            </td>
                            <td className="py-4 px-4">
                              {getStatusBadge(tech.status)}
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex justify-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    alert(`Edit teknisi: ${tech.name}`)
                                  }
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    deleteTechnician(tech.id, tech.name)
                                  }
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6">
                      <div className="text-lg text-gray-700">
                        Menampilkan {startIndex + 1}-
                        {Math.min(
                          startIndex + itemsPerPage,
                          filteredTechnicians.length
                        )}{" "}
                        dari {filteredTechnicians.length} teknisi
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() =>
                            setCurrentPage((prev) => Math.max(prev - 1, 1))
                          }
                          disabled={currentPage === 1}
                          className="text-lg px-4 py-2"
                        >
                          <ChevronLeft className="h-5 w-5 mr-1" />
                          Sebelumnya
                        </Button>
                        <span className="text-lg font-medium px-4">
                          {currentPage} / {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setCurrentPage((prev) =>
                              Math.min(prev + 1, totalPages)
                            )
                          }
                          disabled={currentPage === totalPages}
                          className="text-lg px-4 py-2"
                        >
                          Selanjutnya
                          <ChevronRight className="h-5 w-5 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab 2: Daftar Pekerjaan Teknisi */}
            <TabsContent value="jobs">
              {/* Header Actions */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <Input
                    placeholder="Cari pekerjaan..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10 text-lg py-3"
                  />
                </div>
              </div>

              {/* Jobs Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-2xl">
                    Daftar Pekerjaan Teknisi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            ID Pekerjaan
                          </th>
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Nama Pekerjaan
                          </th>
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Lokasi
                          </th>
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Tanggal Penugasan
                          </th>
                          <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">
                            Status Pekerjaan
                          </th>
                          <th className="text-center py-4 px-4 font-semibold text-gray-700 text-lg">
                            Aksi
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedJobs.map((job) => (
                          <tr
                            key={job.id}
                            className="border-b border-gray-100 hover:bg-gray-50"
                          >
                            <td className="py-4 px-4 font-medium text-gray-900 text-lg">
                              {job.id}
                            </td>
                            <td className="py-4 px-4">
                              <div className="font-medium text-gray-900 text-lg">
                                {job.jobName}
                              </div>
                              <div className="text-sm text-gray-500">
                                Teknisi: {job.technicianName}
                              </div>
                            </td>
                            <td className="py-4 px-4 text-gray-700 text-lg">
                              {job.location}
                            </td>
                            <td className="py-4 px-4 text-gray-700 text-lg">
                              {job.assignmentDate}
                            </td>
                            <td className="py-4 px-4">
                              {getStatusBadge(job.status)}
                            </td>
                            <td className="py-4 px-4">
                              <div className="flex justify-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditJob(job)}
                                  className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteJob(job.id)}
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {jobTotalPages > 1 && (
                    <div className="flex items-center justify-between mt-6">
                      <div className="text-lg text-gray-700">
                        Menampilkan {jobStartIndex + 1}-
                        {Math.min(
                          jobStartIndex + itemsPerPage,
                          filteredJobs.length
                        )}{" "}
                        dari {filteredJobs.length} pekerjaan
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          onClick={() =>
                            setJobCurrentPage((prev) => Math.max(prev - 1, 1))
                          }
                          disabled={jobCurrentPage === 1}
                          className="text-lg px-4 py-2"
                        >
                          <ChevronLeft className="h-5 w-5 mr-1" />
                          Sebelumnya
                        </Button>
                        <span className="text-lg font-medium px-4">
                          {jobCurrentPage} / {jobTotalPages}
                        </span>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setJobCurrentPage((prev) =>
                              Math.min(prev + 1, jobTotalPages)
                            )
                          }
                          disabled={jobCurrentPage === jobTotalPages}
                          className="text-lg px-4 py-2"
                        >
                          Selanjutnya
                          <ChevronRight className="h-5 w-5 ml-1" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Edit Job Modal */}
          <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="text-2xl">Edit Job Teknisi</DialogTitle>
              </DialogHeader>
              {editingJob && (
                <div className="space-y-6">
                  <div>
                    <Label htmlFor="jobName" className="text-lg font-medium">
                      Nama Pekerjaan
                    </Label>
                    <Input
                      id="jobName"
                      value={editingJob.jobName}
                      disabled
                      className="mt-2 text-lg py-3 bg-gray-50"
                    />
                    <p className="text-sm text-gray-500 mt-1">
                      Field ini tidak dapat diedit
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="location" className="text-lg font-medium">
                      Lokasi
                    </Label>
                    <Input
                      id="location"
                      value={editingJob.location}
                      onChange={(e) =>
                        setEditingJob({
                          ...editingJob,
                          location: e.target.value,
                        })
                      }
                      className="mt-2 text-lg py-3"
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor="assignmentDate"
                      className="text-lg font-medium"
                    >
                      Tanggal Penugasan
                    </Label>
                    <Input
                      id="assignmentDate"
                      type="date"
                      value={editingJob.assignmentDate}
                      onChange={(e) =>
                        setEditingJob({
                          ...editingJob,
                          assignmentDate: e.target.value,
                        })
                      }
                      className="mt-2 text-lg py-3"
                    />
                  </div>

                  <div>
                    <Label htmlFor="template" className="text-lg font-medium">
                      Template Laporan
                    </Label>
                    <Select
                      value={editingJob.template}
                      onValueChange={(value) =>
                        setEditingJob({ ...editingJob, template: value })
                      }
                    >
                      <SelectTrigger className="mt-2 text-lg py-3">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Template A">Template A</SelectItem>
                        <SelectItem value="Template B">Template B</SelectItem>
                        <SelectItem value="Template C">Template C</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="notes" className="text-lg font-medium">
                      Catatan Tambahan
                    </Label>
                    <Textarea
                      id="notes"
                      value={editingJob.notes}
                      onChange={(e) =>
                        setEditingJob({ ...editingJob, notes: e.target.value })
                      }
                      className="mt-2 text-lg"
                      rows={4}
                    />
                  </div>

                  <div className="flex gap-4 pt-4">
                    <Button
                      onClick={handleSaveJob}
                      className="bg-blue-600 hover:bg-blue-700 text-lg px-6 py-3"
                    >
                      Simpan Perubahan
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsEditModalOpen(false)}
                      className="text-lg px-6 py-3"
                    >
                      Batal
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </main>
    </div>
  );
}
