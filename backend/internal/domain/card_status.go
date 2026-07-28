package domain

import "fmt"

// BatchActionName 管理端批量操作名（与 API 一致）。
type BatchActionName string

const (
	BatchDisable BatchActionName = "disable"
	BatchEnable  BatchActionName = "enable"
	BatchRestore BatchActionName = "restore"
	BatchDelete  BatchActionName = "delete"
)

// CanApplyBatchAction 判断单卡在给定批量动作下是否允许变更。
// 与 app.BatchAction 的 SQL 过滤语义一致，便于单测锁定规则。
func CanApplyBatchAction(status CardStatus, action BatchActionName) bool {
	switch action {
	case BatchDisable:
		// 仅未使用可禁用
		return status == StatusUnused
	case BatchEnable, BatchRestore:
		// 禁用/已兑可恢复为 unused；过期不可
		return status == StatusDisabled || status == StatusUsed
	case BatchDelete:
		// 仅未用/禁用可物理删除
		return status == StatusUnused || status == StatusDisabled
	default:
		return false
	}
}

// NormalizeBatchAction 规范化动作名。
func NormalizeBatchAction(action string) (BatchActionName, error) {
	switch BatchActionName(action) {
	case BatchDisable, BatchEnable, BatchRestore, BatchDelete:
		return BatchActionName(action), nil
	default:
		return "", fmt.Errorf("无效操作：支持 enable / disable / delete / restore")
	}
}

// RedeemEligibility 兑换前对卡状态的判定（不含过期时间，过期由调用方先折叠为 expired）。
type RedeemEligibility int

const (
	RedeemOK RedeemEligibility = iota
	RedeemDisabled
	RedeemExpired
	RedeemUsed
	RedeemNotUnused // 未知/非法状态
)

// EvaluateRedeemStatus 根据当前卡状态判断兑换路径。
func EvaluateRedeemStatus(status CardStatus) RedeemEligibility {
	switch status {
	case StatusUnused:
		return RedeemOK
	case StatusDisabled:
		return RedeemDisabled
	case StatusExpired:
		return RedeemExpired
	case StatusUsed:
		return RedeemUsed
	default:
		return RedeemNotUnused
	}
}
