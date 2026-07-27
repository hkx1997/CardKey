package paging

// Normalize 将 page / pageSize 规范到合理区间。
func Normalize(page, pageSize, defaultSize, maxSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if defaultSize < 1 {
		defaultSize = 10
	}
	if maxSize < 1 {
		maxSize = 100
	}
	if pageSize < 1 {
		pageSize = defaultSize
	}
	if pageSize > maxSize {
		pageSize = maxSize
	}
	return page, pageSize
}

// Offset 计算 SQL OFFSET。
func Offset(page, pageSize int) int {
	return (page - 1) * pageSize
}
