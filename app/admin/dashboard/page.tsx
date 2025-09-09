"use client"

import { Card, CardContent } from "@/components/ui/card"
import { AdminHeader } from "@/components/admin-header"
import { PWAInstallPrompt } from "@/components/pwa-install-prompt"
import { FileText, CheckCircle, Clock, Users, CalendarCheck, History } from "lucide-react"
import { useRouter } from "next/navigation"

export default function AdminDashboard() {
  const router = useRouter()

  const handleNavigation = (path: string) => {
    router.push(path)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader title="Dashboard Admin" />

      <main className="p-8">
        <div className="max-w-10xl mx-auto">
          {/* Statistics Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <Card className="hover:shadow-lg transition-shadow">
              <CardContent className="p-8">
                <div className="flex items-center">
                  <div className="p-4 bg-green-100 rounded-full">
                    <CheckCircle className="h-12 w-12 text-green-600" />
                  </div>
                  <div className="ml-6">
                    <p className="text-lg font-medium text-gray-600 mb-1">Pekerjaan Selesai</p>
                    <p className="text-4xl font-bold text-gray-900">24</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardContent className="p-8">
                <div className="flex items-center">
                  <div className="p-4 bg-yellow-100 rounded-full">
                    <Clock className="h-12 w-12 text-yellow-600" />
                  </div>
                  <div className="ml-6">
                    <p className="text-lg font-medium text-gray-600 mb-2">Sedang Berlangsung</p>
                    <p className="text-2xl font-bold text-gray-900">8</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="hover:shadow-lg transition-shadow">
              <CardContent className="p-8">
                <div className="flex items-center">
                  <div className="p-4 bg-blue-100 rounded-full">
                    <FileText className="h-12 w-12 text-blue-600" />
                  </div>
                  <div className="ml-6  ">
                    <p className="text-lg font-medium text-gray-600 mb-2">Laporan Dibuat</p>
                    <p className="text-2xl font-bold text-gray-900">18</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Menu Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Card
              className="hover:shadow-lg transition-all cursor-pointer group"
              onClick={() => handleNavigation("/admin/manage_teknisi")}
            >
              <CardContent className="p-10 text-center">
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-6 bg-purple-100 rounded-full group-hover:bg-purple-200 transition-colors">
                    <Users className="h-16 w-16 text-purple-600" />
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 mb-2">Kelola Teknisi</h3>
                    <p className="text-lg text-gray-600">Lihat & kelola data teknisi</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className="hover:shadow-lg transition-all cursor-pointer group"
              onClick={() => handleNavigation("/admin/assign_penjadwalan")}
            >
              <CardContent className="p-10 text-center">
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-6 bg-orange-100 rounded-full group-hover:bg-orange-200 transition-colors">
                    <CalendarCheck className="h-16 w-16 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 mb-2">Assign Penjadwalan</h3>
                    <p className="text-lg text-gray-600">Penjadwalan Project dan Teknisi</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className="hover:shadow-lg transition-all cursor-pointer group"
              onClick={() => handleNavigation("/admin/generate_laporan")}
            >
              <CardContent className="p-10 text-center">
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-6  bg-green-100 rounded-full group-hover:bg-green-200 transition-colors">
                    <FileText className="h-16 w-16 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 mb-2">Generate Laporan</h3>
                    <p className="text-lg text-gray-600">Pilih pekerjaan dan generate laporan</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              className="hover:shadow-lg transition-all cursor-pointer group"
              onClick={() => handleNavigation("/admin/history_pekerjaan")}
            >
              <CardContent className="p-10 text-center">
                <div className="flex flex-col items-center space-y-4">
                  <div className="p-6 bg-indigo-100 rounded-full group-hover:bg-indigo-200 transition-colors">
                    <History className="h-16 w-16 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold text-gray-900 mb-2">Riwayat Pekerjaan</h3>
                    <p className="text-lg text-gray-600">Lihat riwayat semua pekerjaan</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      <PWAInstallPrompt />
    </div>
  )
}
