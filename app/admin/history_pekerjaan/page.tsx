"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AdminHeader } from "@/components/admin-header"
import { Search, History, ChevronLeft, ChevronRight, CheckCircle, Clock, AlertCircle } from "lucide-react"

interface JobHistory {
  id: string
  jobName: string
  technician: string
  status: "completed" | "in-progress" | "pending"
  completedDate: string
  location: string
  reportGenerated: boolean
}

// Mock data for job history
const mockJobHistory: JobHistory[] = [
  {
    id: "JOB-001",
    jobName: "Pemasangan CCTV RW 06",
    technician: "Ahmad Teknisi",
    status: "completed",
    completedDate: "2024-01-15",
    location: "Jl. Merdeka No. 123",
    reportGenerated: true,
  },
  {
    id: "JOB-002",
    jobName: "Maintenance Server Kantor",
    technician: "Budi Teknisi",
    status: "completed",
    completedDate: "2024-01-14",
    location: "Gedung Perkantoran Lt. 5",
    reportGenerated: false,
  },
  {
    id: "JOB-003",
    jobName: "Instalasi Jaringan WiFi",
    technician: "Candra Teknisi",
    status: "in-progress",
    completedDate: "-",
    location: "Komplek Perumahan Blok A",
    reportGenerated: false,
  },
  {
    id: "JOB-004",
    jobName: "Perbaikan Router Mikrotik",
    technician: "Dedi Teknisi",
    status: "completed",
    completedDate: "2024-01-12",
    location: "Warnet Cyber Net",
    reportGenerated: true,
  },
  {
    id: "JOB-005",
    jobName: "Setup Access Point",
    technician: "Eko Teknisi",
    status: "in-progress",
    completedDate: "-",
    location: "Cafe Corner Street",
    reportGenerated: false,
  },
  {
    id: "JOB-006",
    jobName: "Konfigurasi Firewall",
    technician: "Fajar Teknisi",
    status: "in-progress",
    completedDate: "-",
    location: "PT. Teknologi Maju",
    reportGenerated: false,
  },
  {
    id: "JOB-007",
    jobName: "Instalasi CCTV Mall",
    technician: "Ahmad Teknisi",
    status: "completed",
    completedDate: "2024-01-10",
    location: "Mall Central Plaza",
    reportGenerated: true,
  },
  {
    id: "JOB-008",
    jobName: "Maintenance Network",
    technician: "Budi Teknisi",
    status: "in-progress",
    completedDate: "-",
    location: "Kantor Pusat",
    reportGenerated: false,
  },
]

export default function JobHistory() {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 6

  // Filter jobs based on search term and status
  const filteredJobs = mockJobHistory.filter((job) => {
    const matchesSearch =
      job.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.jobName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.technician.toLowerCase().includes(searchTerm.toLowerCase()) ||
      job.location.toLowerCase().includes(searchTerm.toLowerCase())

    const matchesStatus = statusFilter === "all" || job.status === statusFilter

    return matchesSearch && matchesStatus
  })

  // Pagination logic
  const totalPages = Math.ceil(filteredJobs.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginatedJobs = filteredJobs.slice(startIndex, startIndex + itemsPerPage)

  const getStatusBadge = (status: JobHistory["status"]) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
            <CheckCircle className="h-3 w-3 mr-1" />
            Selesai
          </Badge>
        )
      case "in-progress":
        return (
          <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">
            <Clock className="h-3 w-3 mr-1" />
            Ditugaskan
          </Badge>
        )
      case "pending":
        return (
          <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">
            <AlertCircle className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        )
    }
  }

  const getStatusCount = (status: string) => {
    if (status === "all") return mockJobHistory.length
    return mockJobHistory.filter((job) => job.status === status).length
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader title="Riwayat Pekerjaan" showBackButton={true} backUrl="/admin/dashboard" />

      <main className="p-8">
        <div className="max-w-7xl mx-auto">
          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <div className="p-3 bg-blue-100 rounded-full">
                    <History className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">Total Pekerjaan</p>
                    <p className="text-2xl font-bold text-gray-900">{getStatusCount("all")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <div className="p-3 bg-green-100 rounded-full">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">Selesai</p>
                    <p className="text-2xl font-bold text-gray-900">{getStatusCount("completed")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center">
                  <div className="p-3 bg-yellow-100 rounded-full">
                    <Clock className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div className="ml-4">
                    <p className="text-sm font-medium text-gray-600">Ditugaskan</p>
                    <p className="text-2xl font-bold text-gray-900">{getStatusCount("in-progress")}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters and Search */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <div className="flex items-center gap-4 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                <Input
                  placeholder="Cari pekerjaan..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 text-lg py-3"
                />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48 text-lg py-3">
                  <SelectValue placeholder="Filter status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-lg">
                    Semua Status
                  </SelectItem>
                  <SelectItem value="completed" className="text-lg">
                    Selesai
                  </SelectItem>
                  <SelectItem value="in-progress" className="text-lg">
                    Ditugaskan
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Jobs Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Daftar Riwayat Pekerjaan</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">ID Pekerjaan</th>
                      <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">Nama Pekerjaan</th>
                      <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">Teknisi</th>
                      <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">Status</th>
                      <th className="text-left py-4 px-4 font-semibold text-gray-700 text-lg">Tanggal Selesai</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedJobs.map((job) => (
                      <tr key={job.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-4 px-4">
                          <div className="font-medium text-gray-900 text-lg">{job.id}</div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="font-medium text-gray-900 text-lg">{job.jobName}</div>
                          <div className="text-sm text-gray-500">{job.location}</div>
                        </td>
                        <td className="py-4 px-4 text-gray-700 text-lg">{job.technician}</td>
                        <td className="py-4 px-4">{getStatusBadge(job.status)}</td>
                        <td className="py-4 px-4 text-gray-700 text-lg">{job.completedDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-6">
                  <div className="text-lg text-gray-700">
                    Menampilkan {startIndex + 1}-{Math.min(startIndex + itemsPerPage, filteredJobs.length)} dari{" "}
                    {filteredJobs.length} pekerjaan
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
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
                      onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
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
        </div>
      </main>
    </div>
  )
}
