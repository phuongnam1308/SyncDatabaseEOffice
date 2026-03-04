const ROLES_ADMIN = process.env.ROLE_ADMIN || 'ADMIN';
const ROLES_GIAM_DOC = process.env.ROLE_GIAM_DOC || 'GIAM_DOC';
const ROLES_PHO_GIAM_DOC = process.env.ROLE_PHO_GIAM_DOC || 'PHO_GIAM_DOC';
const ROLES_TRUONG_PHONG = process.env.ROLE_TRUONG_PHONG || 'TRUONG_PHONG';
const ROLES_PHO_TRUONG_PHONG = process.env.ROLE_PHO_TRUONG_PHONG || 'PHO_TRUONG_PHONG';
const ROLES_VAN_THU_CUC = process.env.ROLE_VAN_THU_CUC || 'VAN_THU_CUC';
const ROLES_VAN_THU = process.env.ROLE_VAN_THU || 'VAN_THU';
const ROLES_NHAN_VIEN = process.env.ROLE_NHAN_VIEN || 'NHAN_VIEN';

const ADMIN_KEYWORDS = process.env.ADMIN_KEYWORDS ? process.env.ADMIN_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['admin', 'administrator', 'quản trị viên', 'quản trị'];
const GIAMDOC_KEYWORDS = process.env.GIAMDOC_KEYWORDS ? process.env.GIAMDOC_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['giám đốc', 'giam doc'];
const PHO_GIAMDOC_KEYWORDS = process.env.PHO_GIAMDOC_KEYWORDS ? process.env.PHO_GIAMDOC_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['phó giám đốc'];
const TRUONGPHONG_KEYWORDS = process.env.TRUONGPHONG_KEYWORDS ? process.env.TRUONGPHONG_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['trưởng phòng'];
const PHO_TRUONGPHONG_KEYWORDS = process.env.PHO_TRUONGPHONG_KEYWORDS ? process.env.PHO_TRUONGPHONG_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['phó phòng', 'phó trưởng phòng'];
const VANTHUCUC_KEYWORDS = process.env.VANTHUCUC_KEYWORDS ? process.env.VANTHUCUC_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['văn thư cục'];
const VANTHU_KEYWORDS = process.env.VANTHU_KEYWORDS ? process.env.VANTHU_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['văn thư'];
const NHANVIEN_KEYWORDS = process.env.NHANVIEN_KEYWORDS ? process.env.NHANVIEN_KEYWORDS.split(',').map(k => k.trim().toLowerCase()) : ['nhân viên', 'nhan vien', 'cán bộ', 'can bo'];

const roleMapping = [
    { keywords: ADMIN_KEYWORDS, role: ROLES_ADMIN },
    { keywords: GIAMDOC_KEYWORDS, role: ROLES_GIAM_DOC },
    { keywords: PHO_GIAMDOC_KEYWORDS, role: ROLES_PHO_GIAM_DOC },
    { keywords: TRUONGPHONG_KEYWORDS, role: ROLES_TRUONG_PHONG },
    { keywords: PHO_TRUONGPHONG_KEYWORDS, role: ROLES_PHO_TRUONG_PHONG },
    { keywords: VANTHUCUC_KEYWORDS, role: ROLES_VAN_THU_CUC },
    { keywords: VANTHU_KEYWORDS, role: ROLES_VAN_THU },
    { keywords: NHANVIEN_KEYWORDS, role: ROLES_NHAN_VIEN },
];

module.exports = {
    roleMapping,
};
