from __future__ import annotations

import copy
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple


FILES = "abcdefgh"
RANKS = "87654321"  # board index 0 is a8


def sq_to_idx(square: str) -> int:
    if len(square) != 2 or square[0] not in FILES or square[1] not in "12345678":
        raise ValueError("bad_square")
    file_i = FILES.index(square[0])
    rank_i = 8 - int(square[1])
    return rank_i * 8 + file_i


def idx_to_sq(idx: int) -> str:
    r, f = divmod(idx, 8)
    return f"{FILES[f]}{8-r}"


def piece_color(piece: str) -> Optional[str]:
    if piece == ".":
        return None
    return "w" if piece.isupper() else "b"


def piece_type(piece: str) -> str:
    return piece.lower()


@dataclass
class Move:
    from_idx: int
    to_idx: int
    piece: str
    captured: str = "."
    promotion: Optional[str] = None
    castle: Optional[str] = None  # "K", "Q", "k", "q"
    en_passant: bool = False
    prev_ep: Optional[int] = None
    prev_castle: str = ""
    prev_halfmove: int = 0
    prev_fullmove: int = 1
    notation: str = ""

    def uci(self) -> str:
        s = idx_to_sq(self.from_idx) + idx_to_sq(self.to_idx)
        if self.promotion:
            s += self.promotion.lower()
        return s


@dataclass
class ChessGame:
    board: List[str] = field(default_factory=list)
    turn: str = "w"
    castle_rights: str = "KQkq"
    ep_target: Optional[int] = None
    halfmove_clock: int = 0
    fullmove_number: int = 1
    status: str = "ongoing"  # ongoing | checkmate | stalemate | resign | draw | timeout
    winner: Optional[str] = None  # w | b
    draw_reason: Optional[str] = None
    move_history: List[str] = field(default_factory=list)
    move_log: List[Dict[str, str]] = field(default_factory=list)

    def __post_init__(self):
        if not self.board:
            self.reset()

    def reset(self) -> None:
        self.board = list("rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR")
        self.turn = "w"
        self.castle_rights = "KQkq"
        self.ep_target = None
        self.halfmove_clock = 0
        self.fullmove_number = 1
        self.status = "ongoing"
        self.winner = None
        self.draw_reason = None
        self.move_history = []
        self.move_log = []

    def clone(self) -> "ChessGame":
        return copy.deepcopy(self)

    def board_rows(self) -> List[List[str]]:
        return [self.board[r * 8 : (r + 1) * 8] for r in range(8)]

    def king_idx(self, color: str) -> int:
        target = "K" if color == "w" else "k"
        for i, p in enumerate(self.board):
            if p == target:
                return i
        raise ValueError("king_missing")

    def in_bounds(self, idx: int) -> bool:
        return 0 <= idx < 64

    def rank_file(self, idx: int) -> Tuple[int, int]:
        return divmod(idx, 8)

    def is_attacked(self, square_idx: int, by_color: str) -> bool:
        b = self.board
        r, f = divmod(square_idx, 8)

        # pawns
        pawn_dirs = [(1, -1), (1, 1)] if by_color == "w" else [(-1, -1), (-1, 1)]
        for dr, df in pawn_dirs:
            rr = r + dr
            ff = f + df
            if 0 <= rr < 8 and 0 <= ff < 8:
                p = b[rr * 8 + ff]
                if p != "." and piece_color(p) == by_color and piece_type(p) == "p":
                    return True

        # knights
        for dr, df in [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]:
            rr = r + dr
            ff = f + df
            if 0 <= rr < 8 and 0 <= ff < 8:
                p = b[rr * 8 + ff]
                if p != "." and piece_color(p) == by_color and piece_type(p) == "n":
                    return True

        # bishops / queens (diagonals)
        for dr, df in [(-1, -1), (-1, 1), (1, -1), (1, 1)]:
            rr, ff = r + dr, f + df
            while 0 <= rr < 8 and 0 <= ff < 8:
                p = b[rr * 8 + ff]
                if p != ".":
                    if piece_color(p) == by_color and piece_type(p) in {"b", "q"}:
                        return True
                    break
                rr += dr
                ff += df

        # rooks / queens (lines)
        for dr, df in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            rr, ff = r + dr, f + df
            while 0 <= rr < 8 and 0 <= ff < 8:
                p = b[rr * 8 + ff]
                if p != ".":
                    if piece_color(p) == by_color and piece_type(p) in {"r", "q"}:
                        return True
                    break
                rr += dr
                ff += df

        # king
        for dr in (-1, 0, 1):
            for df in (-1, 0, 1):
                if dr == 0 and df == 0:
                    continue
                rr, ff = r + dr, f + df
                if 0 <= rr < 8 and 0 <= ff < 8:
                    p = b[rr * 8 + ff]
                    if p != "." and piece_color(p) == by_color and piece_type(p) == "k":
                        return True
        return False

    def is_in_check(self, color: str) -> bool:
        return self.is_attacked(self.king_idx(color), "b" if color == "w" else "w")

    def _add_slide_moves(self, moves: List[Move], idx: int, piece: str, deltas: List[Tuple[int, int]]) -> None:
        r, f = divmod(idx, 8)
        for dr, df in deltas:
            rr, ff = r + dr, f + df
            while 0 <= rr < 8 and 0 <= ff < 8:
                to_idx = rr * 8 + ff
                target = self.board[to_idx]
                if target == ".":
                    moves.append(Move(idx, to_idx, piece))
                else:
                    if piece_color(target) != piece_color(piece):
                        moves.append(Move(idx, to_idx, piece, captured=target))
                    break
                rr += dr
                ff += df

    def pseudo_moves_for(self, idx: int) -> List[Move]:
        piece = self.board[idx]
        if piece == ".":
            return []
        color = piece_color(piece)
        if color != self.turn:
            return []

        moves: List[Move] = []
        r, f = divmod(idx, 8)
        ptype = piece_type(piece)
        if ptype == "p":
            step = -1 if color == "w" else 1
            start_rank = 6 if color == "w" else 1
            promo_rank = 0 if color == "w" else 7

            # forward one
            rr = r + step
            if 0 <= rr < 8:
                to_idx = rr * 8 + f
                if self.board[to_idx] == ".":
                    if rr == promo_rank:
                        for promo in ["q", "r", "b", "n"]:
                            moves.append(Move(idx, to_idx, piece, promotion=promo))
                    else:
                        moves.append(Move(idx, to_idx, piece))
                    # forward two
                    if r == start_rank:
                        rr2 = r + step * 2
                        to2 = rr2 * 8 + f
                        if self.board[to2] == ".":
                            mv = Move(idx, to2, piece)
                            moves.append(mv)

            # captures and en passant
            for df in (-1, 1):
                ff = f + df
                rr = r + step
                if not (0 <= rr < 8 and 0 <= ff < 8):
                    continue
                to_idx = rr * 8 + ff
                target = self.board[to_idx]
                if target != "." and piece_color(target) != color:
                    if rr == promo_rank:
                        for promo in ["q", "r", "b", "n"]:
                            moves.append(Move(idx, to_idx, piece, captured=target, promotion=promo))
                    else:
                        moves.append(Move(idx, to_idx, piece, captured=target))
                elif self.ep_target is not None and to_idx == self.ep_target:
                    cap_idx = (r * 8 + ff)
                    cap_piece = self.board[cap_idx]
                    if cap_piece != "." and piece_color(cap_piece) != color and piece_type(cap_piece) == "p":
                        moves.append(Move(idx, to_idx, piece, captured=cap_piece, en_passant=True))

        elif ptype == "n":
            for dr, df in [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]:
                rr, ff = r + dr, f + df
                if not (0 <= rr < 8 and 0 <= ff < 8):
                    continue
                to_idx = rr * 8 + ff
                target = self.board[to_idx]
                if target == "." or piece_color(target) != color:
                    moves.append(Move(idx, to_idx, piece, captured=target if target != "." else "."))

        elif ptype == "b":
            self._add_slide_moves(moves, idx, piece, [(-1, -1), (-1, 1), (1, -1), (1, 1)])
        elif ptype == "r":
            self._add_slide_moves(moves, idx, piece, [(-1, 0), (1, 0), (0, -1), (0, 1)])
        elif ptype == "q":
            self._add_slide_moves(
                moves,
                idx,
                piece,
                [(-1, -1), (-1, 1), (1, -1), (1, 1), (-1, 0), (1, 0), (0, -1), (0, 1)],
            )
        elif ptype == "k":
            for dr in (-1, 0, 1):
                for df in (-1, 0, 1):
                    if dr == 0 and df == 0:
                        continue
                    rr, ff = r + dr, f + df
                    if not (0 <= rr < 8 and 0 <= ff < 8):
                        continue
                    to_idx = rr * 8 + ff
                    target = self.board[to_idx]
                    if target == "." or piece_color(target) != color:
                        moves.append(Move(idx, to_idx, piece, captured=target if target != "." else "."))
            # castling
            if color == "w" and idx == sq_to_idx("e1"):
                if "K" in self.castle_rights and self.board[sq_to_idx("f1")] == "." and self.board[sq_to_idx("g1")] == ".":
                    if not self.is_in_check("w") and not self.is_attacked(sq_to_idx("f1"), "b") and not self.is_attacked(sq_to_idx("g1"), "b"):
                        moves.append(Move(idx, sq_to_idx("g1"), piece, castle="K"))
                if "Q" in self.castle_rights and self.board[sq_to_idx("d1")] == "." and self.board[sq_to_idx("c1")] == "." and self.board[sq_to_idx("b1")] == ".":
                    if not self.is_in_check("w") and not self.is_attacked(sq_to_idx("d1"), "b") and not self.is_attacked(sq_to_idx("c1"), "b"):
                        moves.append(Move(idx, sq_to_idx("c1"), piece, castle="Q"))
            if color == "b" and idx == sq_to_idx("e8"):
                if "k" in self.castle_rights and self.board[sq_to_idx("f8")] == "." and self.board[sq_to_idx("g8")] == ".":
                    if not self.is_in_check("b") and not self.is_attacked(sq_to_idx("f8"), "w") and not self.is_attacked(sq_to_idx("g8"), "w"):
                        moves.append(Move(idx, sq_to_idx("g8"), piece, castle="k"))
                if "q" in self.castle_rights and self.board[sq_to_idx("d8")] == "." and self.board[sq_to_idx("c8")] == "." and self.board[sq_to_idx("b8")] == ".":
                    if not self.is_in_check("b") and not self.is_attacked(sq_to_idx("d8"), "w") and not self.is_attacked(sq_to_idx("c8"), "w"):
                        moves.append(Move(idx, sq_to_idx("c8"), piece, castle="q"))
        return moves

    def legal_moves(self, color: Optional[str] = None) -> List[Move]:
        color = color or self.turn
        saved_turn = self.turn
        self.turn = color
        moves: List[Move] = []
        for idx, p in enumerate(self.board):
            if p == "." or piece_color(p) != color:
                continue
            for mv in self.pseudo_moves_for(idx):
                clone = self.clone()
                clone._apply_move_unchecked(mv)
                if not clone.is_in_check(color):
                    moves.append(mv)
        self.turn = saved_turn
        return moves

    def _apply_move_unchecked(self, move: Move) -> None:
        move.prev_ep = self.ep_target
        move.prev_castle = self.castle_rights
        move.prev_halfmove = self.halfmove_clock
        move.prev_fullmove = self.fullmove_number
        piece = self.board[move.from_idx]
        target = self.board[move.to_idx]
        move.captured = move.captured if move.captured != "." else target

        # halfmove
        if piece_type(piece) == "p" or move.captured != ".":
            self.halfmove_clock = 0
        else:
            self.halfmove_clock += 1

        # move piece
        self.board[move.from_idx] = "."
        if move.en_passant:
            r_from, f_to = divmod(move.from_idx, 8)[0], divmod(move.to_idx, 8)[1]
            cap_idx = r_from * 8 + f_to
            self.board[cap_idx] = "."
        self.board[move.to_idx] = piece

        # promotion
        if move.promotion and piece_type(piece) == "p":
            promoted = move.promotion.upper() if piece.isupper() else move.promotion.lower()
            self.board[move.to_idx] = promoted

        # castling rook move
        if move.castle:
            if move.castle == "K":
                self.board[sq_to_idx("h1")] = "."
                self.board[sq_to_idx("f1")] = "R"
            elif move.castle == "Q":
                self.board[sq_to_idx("a1")] = "."
                self.board[sq_to_idx("d1")] = "R"
            elif move.castle == "k":
                self.board[sq_to_idx("h8")] = "."
                self.board[sq_to_idx("f8")] = "r"
            elif move.castle == "q":
                self.board[sq_to_idx("a8")] = "."
                self.board[sq_to_idx("d8")] = "r"

        # update castle rights
        rights = set(self.castle_rights)
        moved_piece = piece
        if moved_piece == "K":
            rights.discard("K"); rights.discard("Q")
        elif moved_piece == "k":
            rights.discard("k"); rights.discard("q")
        if move.from_idx == sq_to_idx("h1") or move.to_idx == sq_to_idx("h1"):
            rights.discard("K")
        if move.from_idx == sq_to_idx("a1") or move.to_idx == sq_to_idx("a1"):
            rights.discard("Q")
        if move.from_idx == sq_to_idx("h8") or move.to_idx == sq_to_idx("h8"):
            rights.discard("k")
        if move.from_idx == sq_to_idx("a8") or move.to_idx == sq_to_idx("a8"):
            rights.discard("q")
        self.castle_rights = "".join(ch for ch in "KQkq" if ch in rights)

        # en passant target
        self.ep_target = None
        if piece_type(piece) == "p":
            from_r, from_f = divmod(move.from_idx, 8)
            to_r, _ = divmod(move.to_idx, 8)
            if abs(to_r - from_r) == 2:
                mid_r = (to_r + from_r) // 2
                self.ep_target = mid_r * 8 + from_f

        # turn/fullmove
        if self.turn == "b":
            self.fullmove_number += 1
        self.turn = "b" if self.turn == "w" else "w"

    def make_move(self, uci_from: str, uci_to: str, promotion: Optional[str] = None) -> Tuple[bool, str, Optional[Move]]:
        if self.status != "ongoing":
            return False, "game_over", None
        try:
            from_idx = sq_to_idx(uci_from)
            to_idx = sq_to_idx(uci_to)
        except ValueError:
            return False, "bad_square", None
        legal = self.legal_moves(self.turn)
        chosen: Optional[Move] = None
        for mv in legal:
            if mv.from_idx == from_idx and mv.to_idx == to_idx:
                if mv.promotion:
                    desired = (promotion or "q").lower()
                    if mv.promotion.lower() != desired:
                        continue
                chosen = mv
                break
        if chosen is None:
            return False, "illegal_move", None

        mover = self.turn
        self._apply_move_unchecked(chosen)
        notation = chosen.uci()
        if self.is_in_check(self.turn):
            notation += "+"
        self.move_history.append(notation)
        self.move_log.append(
            {
                "ply": str(len(self.move_history)),
                "move": notation,
                "side": mover,
            }
        )
        self._update_terminal_state()
        return True, "ok", chosen

    def _update_terminal_state(self) -> None:
        legal = self.legal_moves(self.turn)
        if legal:
            # 50-move rule (optional simple)
            if self.halfmove_clock >= 100:
                self.status = "draw"
                self.draw_reason = "50-move"
            return
        if self.is_in_check(self.turn):
            self.status = "checkmate"
            self.winner = "b" if self.turn == "w" else "w"
        else:
            self.status = "draw"
            self.draw_reason = "stalemate"

    def resign(self, color: str) -> None:
        if self.status != "ongoing":
            return
        self.status = "resign"
        self.winner = "b" if color == "w" else "w"

    def force_draw(self, reason: str = "agreed") -> None:
        if self.status != "ongoing":
            return
        self.status = "draw"
        self.draw_reason = reason

    def timeout(self, loser_color: str) -> None:
        if self.status != "ongoing":
            return
        self.status = "timeout"
        self.winner = "b" if loser_color == "w" else "w"

    def fen_like(self) -> str:
        rows = []
        for r in range(8):
            run = 0
            parts = []
            for p in self.board[r * 8 : (r + 1) * 8]:
                if p == ".":
                    run += 1
                else:
                    if run:
                        parts.append(str(run))
                        run = 0
                    parts.append(p)
            if run:
                parts.append(str(run))
            rows.append("".join(parts))
        return f"{'/'.join(rows)} {self.turn} {self.castle_rights or '-'} {idx_to_sq(self.ep_target) if self.ep_target is not None else '-'} {self.halfmove_clock} {self.fullmove_number}"


class ChessRoom:
    mode = "chess"

    def __init__(self, room_id: str, db, clock_ms: int = 5 * 60 * 1000):
        self.room_id = room_id
        self.db = db
        self.members: Set[int] = set()
        self.players: Dict[str, Optional[int]] = {"w": None, "b": None}
        self.spectators: Set[int] = set()
        self.game = ChessGame()
        self.outbox: List[dict] = []
        self.draw_offer_from: Optional[str] = None
        self.state = "waiting"
        self.ended = False
        self.clock_enabled = True
        self.clock_ms = {"w": int(clock_ms), "b": int(clock_ms)}
        self._last_tick = time.time()
        self._result_applied = False
        self._snapshot_accum = 0.0

    def join(self, user_id: int) -> dict:
        self.members.add(user_id)
        seat = None
        if self.players["w"] is None:
            self.players["w"] = user_id
            seat = "w"
        elif self.players["b"] is None and user_id != self.players["w"]:
            self.players["b"] = user_id
            seat = "b"
        else:
            self.spectators.add(user_id)
            seat = "spectator"
        if self.players["w"] and self.players["b"] and self.state == "waiting":
            self.state = "running"
            self._last_tick = time.time()
        self.outbox.append({"type": "chess_roster", "room_id": self.room_id, "players": self.players, "spectators": list(self.spectators)})
        return {"seat": seat, "state": self.state}

    def leave(self, user_id: int) -> None:
        self.members.discard(user_id)
        self.spectators.discard(user_id)
        for side in ("w", "b"):
            if self.players[side] == user_id:
                self.players[side] = None
                if not self.ended and self.state == "running":
                    self.game.resign(side)
                    self.state = "ended"
                    self.ended = True
                    self._apply_result_if_needed()
                    self.outbox.append({"type": "chess_end", "room_id": self.room_id, "reason": "player_left"})
        self.outbox.append({"type": "chess_roster", "room_id": self.room_id, "players": self.players, "spectators": list(self.spectators)})

    def _side_for_user(self, user_id: int) -> Optional[str]:
        for side, uid in self.players.items():
            if uid == user_id:
                return side
        return None

    def handle(self, user_id: int, msg: dict) -> None:
        t = msg.get("type")
        if t == "chess_move":
            side = self._side_for_user(user_id)
            if self.ended or self.state != "running" or side != self.game.turn:
                return
            move_from = str(msg.get("from", ""))
            move_to = str(msg.get("to", ""))
            promo = str(msg.get("promotion", "q") or "q")
            ok, reason, move = self.game.make_move(move_from, move_to, promo)
            if ok:
                self.draw_offer_from = None
                self.outbox.append(
                    {
                        "type": "chess_move_ok",
                        "room_id": self.room_id,
                        "uci": move.uci() if move else "",
                        "fen": self.game.fen_like(),
                        "status": self.game.status,
                    }
                )
                if self.game.status != "ongoing":
                    self.state = "ended"
                    self.ended = True
                    self._apply_result_if_needed()
                    self.outbox.append({"type": "chess_end", "room_id": self.room_id, "status": self.game.status, "winner": self.game.winner})
            else:
                self.outbox.append({"type": "chess_move_reject", "room_id": self.room_id, "reason": reason, "to_user": user_id})
        elif t == "chess_resign":
            side = self._side_for_user(user_id)
            if side and not self.ended:
                self.game.resign(side)
                self.state = "ended"
                self.ended = True
                self._apply_result_if_needed()
                self.outbox.append({"type": "chess_end", "room_id": self.room_id, "status": "resign", "winner": self.game.winner})
        elif t == "chess_offer_draw":
            side = self._side_for_user(user_id)
            if side and not self.ended and self.draw_offer_from != side:
                self.draw_offer_from = side
                self.outbox.append({"type": "chess_draw_offer", "room_id": self.room_id, "from": side})
        elif t == "chess_accept_draw":
            side = self._side_for_user(user_id)
            if side and not self.ended and self.draw_offer_from and self.draw_offer_from != side:
                self.game.force_draw("agreed")
                self.state = "ended"
                self.ended = True
                self._apply_result_if_needed()
                self.outbox.append({"type": "chess_end", "room_id": self.room_id, "status": "draw", "reason": "agreed"})
        elif t == "chess_restart" and self.ended:
            self._restart_preserve_roster()

    def _restart_preserve_roster(self) -> None:
        members = list(self.members)
        white = self.players["w"]
        black = self.players["b"]
        self.__init__(self.room_id, self.db)
        # preserve seat assignments when possible
        self.members = set(members)
        self.players = {"w": white, "b": black}
        self.spectators = set([uid for uid in members if uid not in {white, black}])
        if white and black:
            self.state = "running"
        self.outbox.append({"type": "chess_roster", "room_id": self.room_id, "players": self.players, "spectators": list(self.spectators)})

    def _apply_result_if_needed(self) -> None:
        if self._result_applied:
            return
        self._result_applied = True
        w_uid = self.players.get("w")
        b_uid = self.players.get("b")
        if not (w_uid and b_uid):
            return
        if self.game.status == "draw":
            return
        if self.game.winner == "w":
            self.db.apply_match_result(int(w_uid), win=True)
            self.db.apply_match_result(int(b_uid), win=False)
        elif self.game.winner == "b":
            self.db.apply_match_result(int(b_uid), win=True)
            self.db.apply_match_result(int(w_uid), win=False)

    def tick(self, dt: float) -> None:
        self._snapshot_accum += dt
        if self.state == "running" and not self.ended and self.clock_enabled:
            side = self.game.turn
            self.clock_ms[side] = max(0, self.clock_ms[side] - int(dt * 1000))
            if self.clock_ms[side] <= 0:
                self.game.timeout(side)
                self.state = "ended"
                self.ended = True
                self._apply_result_if_needed()
                self.outbox.append({"type": "chess_end", "room_id": self.room_id, "status": "timeout", "winner": self.game.winner})
        if self._snapshot_accum >= 0.25:
            self._snapshot_accum = 0.0
            self.outbox.append(self.snapshot())

    def snapshot(self) -> dict:
        return {
            "type": "chess_state",
            "room_id": self.room_id,
            "state": self.state,
            "players": self.players,
            "spectators": list(self.spectators),
            "board": self.game.board_rows(),
            "turn": self.game.turn,
            "castle_rights": self.game.castle_rights,
            "ep": idx_to_sq(self.game.ep_target) if self.game.ep_target is not None else None,
            "status": self.game.status,
            "winner": self.game.winner,
            "draw_reason": self.game.draw_reason,
            "moves": self.game.move_log[-120:],
            "fen": self.game.fen_like(),
            "clocks_ms": self.clock_ms,
            "draw_offer_from": self.draw_offer_from,
        }

    def drain_outbox(self) -> List[dict]:
        out, self.outbox = self.outbox, []
        return out
